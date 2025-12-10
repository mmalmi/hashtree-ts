<script lang="ts">
  /**
   * HtmlViewer - renders HTML content in a sandboxed iframe
   * Resources are resolved relative to the current directory
   */
  import { routeStore, currentDirCidStore, directoryEntriesStore } from '../../stores';
  import { getTree } from '../../store';
  import type { TreeEntry } from 'hashtree';

  interface Props {
    content: string;
    fileName: string;
  }

  let { content, fileName }: Props = $props();

  let route = $derived($routeStore);
  let currentDirCid = $derived($currentDirCidStore);
  let dirEntries = $derived($directoryEntriesStore);
  let entries = $derived(dirEntries.entries);

  // Build a map of files in current directory for resource lookup
  let fileMap = $derived.by(() => {
    const map = new Map<string, TreeEntry>();
    for (const entry of entries) {
      map.set(entry.name, entry);
    }
    return map;
  });

  // Recursively resolve path segments to get an entry
  async function resolveRelativePath(pathParts: string[], currentEntries: TreeEntry[]): Promise<TreeEntry | null> {
    if (pathParts.length === 0) return null;

    const [first, ...rest] = pathParts;

    // Handle ".." by going up (not supported in sandboxed view)
    if (first === '..') return null;

    // Find entry with this name
    const entry = currentEntries.find(e => e.name === first);
    if (!entry) return null;

    // If this is the last segment, return it
    if (rest.length === 0) return entry;

    // If it's a directory, recurse into it
    if (entry.isTree && entry.cid) {
      const tree = getTree();
      const subEntries = await tree.listDirectory(entry.cid);
      if (subEntries) {
        return resolveRelativePath(rest, subEntries);
      }
    }

    return null;
  }

  // Transform HTML content to use blob URLs for resources
  let transformedHtml = $state<string>('');
  let iframeSrc = $state<string>('');

  $effect(() => {
    let cancelled = false;

    async function transformContent() {
      const html = content;
      const currentEntries = entries;
      const tree = getTree();

      // Find all resource references (src, href attributes)
      const resourcePatterns = [
        /src="([^"]+)"/gi,
        /href="([^"]+\.(?:css|js|ico|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot))"/gi,
      ];

      // Collect all URLs to replace
      const replacements = new Map<string, string>();

      for (const pattern of resourcePatterns) {
        let match;
        const regex = new RegExp(pattern.source, pattern.flags);
        while ((match = regex.exec(html)) !== null) {
          const url = match[1];

          // Skip external URLs and data URLs
          if (url.startsWith('http://') || url.startsWith('https://') ||
              url.startsWith('data:') || url.startsWith('//') ||
              url.startsWith('#')) {
            continue;
          }

          if (!replacements.has(url)) {
            // Parse the relative path
            const pathParts = url.split('/').filter(p => p && p !== '.');

            // Resolve to an entry
            const entry = await resolveRelativePath(pathParts, currentEntries);

            if (entry && entry.cid && !entry.isTree) {
              // Read the file content
              const data = await tree.readFile(entry.cid);
              if (data && !cancelled) {
                // Create blob URL
                const mimeType = getMimeType(entry.name);
                const blob = new Blob([data], { type: mimeType });
                const blobUrl = URL.createObjectURL(blob);
                replacements.set(url, blobUrl);
              }
            }
          }
        }
      }

      if (cancelled) return;

      // Replace all URLs in HTML
      let result = html;
      for (const [originalUrl, blobUrl] of replacements) {
        // Escape special regex characters in URL
        const escaped = originalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        result = result.replace(new RegExp(`(src|href)="${escaped}"`, 'gi'), `$1="${blobUrl}"`);
      }

      transformedHtml = result;

      // Create blob for the entire HTML
      const htmlBlob = new Blob([result], { type: 'text/html' });
      const newSrc = URL.createObjectURL(htmlBlob);

      // Clean up old blob URL
      if (iframeSrc) {
        URL.revokeObjectURL(iframeSrc);
      }

      iframeSrc = newSrc;
    }

    transformContent();

    return () => {
      cancelled = true;
      if (iframeSrc) {
        URL.revokeObjectURL(iframeSrc);
      }
    };
  });

  function getMimeType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    const mimeTypes: Record<string, string> = {
      'css': 'text/css',
      'js': 'text/javascript',
      'json': 'application/json',
      'html': 'text/html',
      'htm': 'text/html',
      'png': 'image/png',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'gif': 'image/gif',
      'svg': 'image/svg+xml',
      'ico': 'image/x-icon',
      'woff': 'font/woff',
      'woff2': 'font/woff2',
      'ttf': 'font/ttf',
      'eot': 'application/vnd.ms-fontobject',
      'mp3': 'audio/mpeg',
      'mp4': 'video/mp4',
      'webm': 'video/webm',
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }
</script>

<div class="flex-1 flex flex-col min-h-0">
  {#if iframeSrc}
    <iframe
      src={iframeSrc}
      class="flex-1 w-full border-0 bg-white"
      sandbox="allow-scripts"
      title={fileName}
    ></iframe>
  {:else}
    <div class="flex-1 flex items-center justify-center text-muted">
      Loading...
    </div>
  {/if}
</div>
