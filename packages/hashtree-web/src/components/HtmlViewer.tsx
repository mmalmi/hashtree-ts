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
 * Create blob URLs for all files and return a mapping
 */
function createBlobUrls(files: DirectoryFile[]): Map<string, string> {
  const urls = new Map<string, string>();
  for (const file of files) {
    const blob = new Blob([file.data], { type: file.mimeType });
    urls.set(file.name.toLowerCase(), URL.createObjectURL(blob));
  }
  return urls;
}

/**
 * Inject resource interception script into HTML
 * This rewrites relative URLs to use blob URLs
 */
function injectResourceLoader(html: string, fileUrls: Map<string, string>): string {
  // Create a JSON map of filename -> blob URL
  const urlMap: Record<string, string> = {};
  fileUrls.forEach((url, name) => {
    urlMap[name] = url;
  });

  // Script that intercepts resource loading
  const interceptScript = `
<script>
(function() {
  const fileUrls = ${JSON.stringify(urlMap)};

  // Helper to resolve URL
  function resolveUrl(url) {
    if (!url) return url;
    // Skip absolute URLs and data URLs
    if (url.startsWith('http://') || url.startsWith('https://') ||
        url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('//')) {
      return url;
    }
    // Remove leading ./ or /
    const cleanUrl = url.replace(/^\\.?\\//, '').toLowerCase();
    return fileUrls[cleanUrl] || url;
  }

  // Override fetch
  const originalFetch = window.fetch;
  window.fetch = function(url, options) {
    const resolved = resolveUrl(typeof url === 'string' ? url : url.url);
    if (resolved !== url) {
      return originalFetch(resolved, options);
    }
    return originalFetch(url, options);
  };

  // Override XMLHttpRequest
  const originalXhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    const resolved = resolveUrl(url);
    return originalXhrOpen.call(this, method, resolved, ...rest);
  };

  // Observe DOM for new elements with src/href attributes
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === 1) {
          const el = node;
          if (el.src) el.src = resolveUrl(el.src);
          if (el.href && el.tagName !== 'A') el.href = resolveUrl(el.href);
          // Handle child elements
          el.querySelectorAll && el.querySelectorAll('[src], link[href]').forEach((child) => {
            if (child.src) child.src = resolveUrl(child.src);
            if (child.href && child.tagName === 'LINK') child.href = resolveUrl(child.href);
          });
        }
      });
    });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
</script>
`;

  // Inject script at the beginning of <head> or after <!DOCTYPE>
  if (html.includes('<head>')) {
    return html.replace('<head>', '<head>' + interceptScript);
  } else if (html.includes('<head ')) {
    return html.replace(/<head\s/, '<head>' + interceptScript + '</head><head ');
  } else if (html.toLowerCase().includes('<!doctype')) {
    return html.replace(/<!doctype[^>]*>/i, '$&' + interceptScript);
  } else {
    return interceptScript + html;
  }
}

/**
 * Rewrite static resource URLs in HTML
 */
function rewriteStaticUrls(html: string, fileUrls: Map<string, string>): string {
  let result = html;

  // Rewrite src attributes
  result = result.replace(
    /(<(?:img|script|audio|video|source|embed|iframe)[^>]*\s)src\s*=\s*["']([^"']+)["']/gi,
    (match, prefix, src) => {
      const cleanSrc = src.replace(/^\.?\//, '').toLowerCase();
      const blobUrl = fileUrls.get(cleanSrc);
      if (blobUrl) {
        return `${prefix}src="${blobUrl}"`;
      }
      return match;
    }
  );

  // Rewrite href attributes for link tags (CSS)
  result = result.replace(
    /(<link[^>]*\s)href\s*=\s*["']([^"']+)["']/gi,
    (match, prefix, href) => {
      const cleanHref = href.replace(/^\.?\//, '').toLowerCase();
      const blobUrl = fileUrls.get(cleanHref);
      if (blobUrl) {
        return `${prefix}href="${blobUrl}"`;
      }
      return match;
    }
  );

  // Rewrite url() in inline styles
  result = result.replace(
    /url\(\s*["']?([^"')]+)["']?\s*\)/gi,
    (match, url) => {
      if (url.startsWith('http://') || url.startsWith('https://') ||
          url.startsWith('data:') || url.startsWith('blob:')) {
        return match;
      }
      const cleanUrl = url.replace(/^\.?\//, '').toLowerCase();
      const blobUrl = fileUrls.get(cleanUrl);
      if (blobUrl) {
        return `url("${blobUrl}")`;
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

  // Create blob URLs and modified HTML (only when files are loaded)
  const { blobUrl, cleanup } = useMemo(() => {
    if (loading) {
      // Don't create blob URL while loading
      return { blobUrl: '', cleanup: () => {} };
    }

    if (files.length === 0) {
      // No sibling files - just render HTML as-is
      const blob = new Blob([html], { type: 'text/html' });
      return { blobUrl: URL.createObjectURL(blob), cleanup: () => {} };
    }

    // Create blob URLs for all files
    const fileUrls = createBlobUrls(files);

    // Rewrite HTML to use blob URLs
    let modifiedHtml = rewriteStaticUrls(html, fileUrls);
    modifiedHtml = injectResourceLoader(modifiedHtml, fileUrls);

    const blob = new Blob([modifiedHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);

    return {
      blobUrl: url,
      cleanup: () => {
        URL.revokeObjectURL(url);
        fileUrls.forEach((blobUrl) => URL.revokeObjectURL(blobUrl));
      },
    };
  }, [html, files, loading]);

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

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

  return (
    <iframe
      src={blobUrl}
      className="block w-full h-full border-none bg-surface-0"
      title={filename}
      sandbox="allow-scripts allow-same-origin"
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
