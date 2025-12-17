<script lang="ts">
  /**
   * HtmlViewer - renders HTML content in a sandboxed iframe
   *
   * Injects a <base> tag so relative URLs resolve to SW paths,
   * but serves HTML as blob to maintain sandbox security (no same-origin).
   * The SW then intercepts resource requests and serves from hashtree.
   */
  import { untrack } from 'svelte';
  import { routeStore } from '../../stores';

  interface Props {
    content: string;
    fileName: string;
  }

  let { content, fileName }: Props = $props();

  let route = $derived($routeStore);

  // Build base URL for the directory containing the HTML file
  // e.g., /htree/npub1.../treeName/path/to/ (trailing slash for directory)
  let baseUrl = $derived.by(() => {
    if (!route.npub || !route.treeName) return '';

    const encodedTreeName = encodeURIComponent(route.treeName);
    // Get directory path (all segments except the filename)
    const dirPath = route.path.slice(0, -1);
    const encodedPath = dirPath.map(encodeURIComponent).join('/');

    // Build base URL with trailing slash
    let base = `/htree/${route.npub}/${encodedTreeName}`;
    if (encodedPath) {
      base += `/${encodedPath}`;
    }
    return base + '/';
  });

  let iframeSrc = $state<string>('');

  // Inject <base> tag into HTML and create blob URL
  $effect(() => {
    if (!content || !baseUrl) {
      return;
    }

    // Inject <base href="..."> tag to make relative URLs resolve to SW paths
    // Insert after <head> if present, otherwise at start
    let modifiedHtml = content;
    const baseTag = `<base href="${baseUrl}">`;

    if (/<head[^>]*>/i.test(modifiedHtml)) {
      modifiedHtml = modifiedHtml.replace(/<head[^>]*>/i, `$&${baseTag}`);
    } else if (/<html[^>]*>/i.test(modifiedHtml)) {
      modifiedHtml = modifiedHtml.replace(/<html[^>]*>/i, `$&<head>${baseTag}</head>`);
    } else {
      // No html/head tags - prepend base tag
      modifiedHtml = baseTag + modifiedHtml;
    }

    // Create blob URL for the modified HTML
    const blob = new Blob([modifiedHtml], { type: 'text/html' });
    const newSrc = URL.createObjectURL(blob);

    // Store old URL for cleanup before setting new one (use untrack to avoid dependency)
    const oldSrc = untrack(() => iframeSrc);
    iframeSrc = newSrc;

    // Cleanup: revoke old blob URL
    if (oldSrc) {
      URL.revokeObjectURL(oldSrc);
    }

    return () => {
      // Revoke on component unmount
      URL.revokeObjectURL(newSrc);
    };
  });
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
