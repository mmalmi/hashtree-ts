/**
 * HTML Viewer with directory context
 *
 * Renders HTML files in a sandboxed iframe with access to sibling files
 * from the same directory. Uses blob URLs and script injection to intercept
 * resource loading.
 */
import { useEffect, useState, useMemo } from 'react';
import type { CID } from 'hashtree';
import { getTree } from '../store';

interface HtmlViewerProps {
  /** The HTML content to render */
  html: string;
  /** CID of the parent directory */
  directoryCid: CID;
  /** Filename for the title */
  filename?: string;
}

interface DirectoryFile {
  name: string;
  data: Uint8Array;
  mimeType: string;
}

/**
 * Get MIME type from filename
 */
function getMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const mimeTypes: Record<string, string> = {
    // Images
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'svg': 'image/svg+xml',
    'ico': 'image/x-icon',
    'bmp': 'image/bmp',
    // CSS/JS
    'css': 'text/css',
    'js': 'text/javascript',
    'mjs': 'text/javascript',
    // Fonts
    'woff': 'font/woff',
    'woff2': 'font/woff2',
    'ttf': 'font/ttf',
    'otf': 'font/otf',
    'eot': 'application/vnd.ms-fontobject',
    // Data
    'json': 'application/json',
    'xml': 'application/xml',
    'txt': 'text/plain',
    // HTML
    'html': 'text/html',
    'htm': 'text/html',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * Recursively collect all files from a directory tree
 */
async function collectDirectoryFiles(
  dirCid: CID,
  basePath: string = ''
): Promise<DirectoryFile[]> {
  const tree = getTree();
  const entries = await tree.listDirectory(dirCid);
  const files: DirectoryFile[] = [];

  for (const entry of entries) {
    const fullPath = basePath ? `${basePath}/${entry.name}` : entry.name;

    if (entry.isTree) {
      // Recursively collect subdirectory
      const subFiles = await collectDirectoryFiles(entry.cid, fullPath);
      files.push(...subFiles);
    } else {
      const data = await tree.readFile(entry.cid);
      if (data) {
        files.push({
          name: fullPath,
          data,
          mimeType: getMimeType(entry.name),
        });
      }
    }
  }

  return files;
}


/**
 * Inline resources directly into HTML for security
 * This avoids needing allow-same-origin in the sandbox
 */
function inlineResources(html: string, files: DirectoryFile[]): string {
  // Create a map of filename -> file data
  const fileMap = new Map<string, DirectoryFile>();
  for (const file of files) {
    fileMap.set(file.name.toLowerCase(), file);
  }

  let result = html;

  // Inline <script src="..."> as <script>content</script>
  result = result.replace(
    /<script([^>]*)\ssrc\s*=\s*["']([^"']+)["']([^>]*)><\/script>/gi,
    (match, before, src, after) => {
      const cleanSrc = src.replace(/^\.?\//, '').toLowerCase();
      const file = fileMap.get(cleanSrc);
      if (file && (file.mimeType === 'text/javascript' || file.mimeType === 'application/javascript')) {
        const content = new TextDecoder().decode(file.data);
        return `<script${before}${after}>${content}</script>`;
      }
      return match;
    }
  );

  // Inline <link rel="stylesheet" href="..."> as <style>content</style>
  result = result.replace(
    /<link([^>]*)rel\s*=\s*["']stylesheet["']([^>]*)href\s*=\s*["']([^"']+)["']([^>]*)>/gi,
    (match, _before1, _before2, href, _after) => {
      const cleanHref = href.replace(/^\.?\//, '').toLowerCase();
      const file = fileMap.get(cleanHref);
      if (file && file.mimeType === 'text/css') {
        const content = new TextDecoder().decode(file.data);
        return `<style>${content}</style>`;
      }
      return match;
    }
  );

  // Also handle href before rel
  result = result.replace(
    /<link([^>]*)href\s*=\s*["']([^"']+)["']([^>]*)rel\s*=\s*["']stylesheet["']([^>]*)>/gi,
    (match, _before1, href, _before2, _after) => {
      const cleanHref = href.replace(/^\.?\//, '').toLowerCase();
      const file = fileMap.get(cleanHref);
      if (file && file.mimeType === 'text/css') {
        const content = new TextDecoder().decode(file.data);
        return `<style>${content}</style>`;
      }
      return match;
    }
  );

  // Convert images to data URLs
  result = result.replace(
    /(<img[^>]*\s)src\s*=\s*["']([^"']+)["']/gi,
    (match, prefix, src) => {
      if (src.startsWith('http://') || src.startsWith('https://') ||
          src.startsWith('data:') || src.startsWith('blob:')) {
        return match;
      }
      const cleanSrc = src.replace(/^\.?\//, '').toLowerCase();
      const file = fileMap.get(cleanSrc);
      if (file && file.mimeType.startsWith('image/')) {
        const base64 = btoa(String.fromCharCode(...file.data));
        return `${prefix}src="data:${file.mimeType};base64,${base64}"`;
      }
      return match;
    }
  );

  // Convert url() in CSS to data URLs
  result = result.replace(
    /url\(\s*["']?([^"')]+)["']?\s*\)/gi,
    (match, url) => {
      if (url.startsWith('http://') || url.startsWith('https://') ||
          url.startsWith('data:') || url.startsWith('blob:')) {
        return match;
      }
      const cleanUrl = url.replace(/^\.?\//, '').toLowerCase();
      const file = fileMap.get(cleanUrl);
      if (file && (file.mimeType.startsWith('image/') || file.mimeType.startsWith('font/'))) {
        const base64 = btoa(String.fromCharCode(...file.data));
        return `url("data:${file.mimeType};base64,${base64}")`;
      }
      return match;
    }
  );

  return result;
}

export function HtmlViewer({ html, directoryCid, filename }: HtmlViewerProps) {
  const [files, setFiles] = useState<DirectoryFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load directory files
  useEffect(() => {
    let cancelled = false;

    async function loadFiles() {
      try {
        setLoading(true);
        const dirFiles = await collectDirectoryFiles(directoryCid);
        if (!cancelled) {
          setFiles(dirFiles);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load directory');
          setLoading(false);
        }
      }
    }

    loadFiles();
    return () => { cancelled = true; };
  }, [directoryCid]);

  // Create modified HTML with inlined resources (only when files are loaded)
  const modifiedHtml = useMemo(() => {
    if (loading) {
      return '';
    }

    // Inline all resources directly into HTML for security
    // This allows us to use sandbox="allow-scripts" without allow-same-origin
    return files.length > 0
      ? inlineResources(html, files)
      : html;
  }, [html, files, loading]);

  if (error) {
    return (
      <div className="p-4 text-error">
        Error loading directory: {error}
      </div>
    );
  }

  // Show loading state while collecting directory files
  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center text-muted">
        Loading resources...
      </div>
    );
  }

  // SECURITY: Only allow-scripts, NEVER add allow-same-origin!
  // allow-same-origin would let untrusted HTML access our localStorage, cookies,
  // IndexedDB, and make credentialed requests to our origin.
  // With only allow-scripts: JS runs but iframe has opaque origin (no access to parent data).
  return (
    <iframe
      srcDoc={modifiedHtml}
      className="block w-full h-full border-none bg-surface-0"
      title={filename}
      sandbox="allow-scripts"
    />
  );
}

/**
 * Check if HTML viewer with directory context should be used
 * (when the file is HTML and we have a directory context)
 */
export function shouldUseHtmlViewer(filename: string | undefined): boolean {
  if (!filename) return false;
  const lower = filename.toLowerCase();
  return lower.endsWith('.html') || lower.endsWith('.htm');
}
