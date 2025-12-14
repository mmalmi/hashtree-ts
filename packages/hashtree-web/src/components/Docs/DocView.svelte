<script lang="ts">
  /**
   * DocView - Document view for docs.iris.to
   * Resolves tree path and renders YjsDocumentEditor
   */
  import { routeStore, treeRootStore } from '../../stores';
  import { getTree } from '../../store';
  import { LinkType, type CID, type TreeEntry } from 'hashtree';
  import YjsDocumentEditor from '../Viewer/YjsDocumentEditor.svelte';

  let route = $derived($routeStore);
  let treeRoot = $derived($treeRootStore);

  // Resolved directory state
  let dirCid = $state<CID | null>(null);
  let dirName = $state<string>('');
  let entries = $state<TreeEntry[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  // Check if this is a yjs document (has .yjs file)
  let isYjsDoc = $derived(entries.some(e => e.name === '.yjs'));

  // Resolve path when route or tree root changes
  $effect(() => {
    const root = treeRoot;
    const path = route.path;

    if (!root) {
      loading = true;
      return;
    }

    loading = true;
    error = null;

    const tree = getTree();
    const pathStr = path.join('/');

    (async () => {
      try {
        // If path is empty, we're at the tree root
        let targetCid: CID;
        if (path.length === 0) {
          targetCid = root;
          dirName = route.treeName || 'Document';
        } else {
          const result = await tree.resolvePath(root, pathStr);
          if (!result) {
            error = 'Document not found';
            loading = false;
            return;
          }
          targetCid = result.cid;
          dirName = path[path.length - 1];
        }

        // Check if it's a directory
        const isDir = await tree.isDirectory(targetCid);
        if (!isDir) {
          error = 'Not a document directory';
          loading = false;
          return;
        }

        // List entries
        const dirEntries = await tree.listDirectory(targetCid);
        dirCid = targetCid;
        entries = dirEntries;
        loading = false;
      } catch (e) {
        console.error('[DocView] Error resolving path:', e);
        error = 'Failed to load document';
        loading = false;
      }
    })();
  });
</script>

{#if loading}
  <div class="flex-1 flex items-center justify-center text-text-3">
    <span class="i-lucide-loader-2 animate-spin mr-2"></span>
    Loading document...
  </div>
{:else if error}
  <div class="flex-1 flex flex-col items-center justify-center text-text-3 p-6">
    <span class="i-lucide-file-x text-4xl mb-4"></span>
    <p class="text-lg mb-2">{error}</p>
    <a href="#/" class="text-accent hover:underline">Back to home</a>
  </div>
{:else if isYjsDoc && dirCid}
  <YjsDocumentEditor {dirCid} {dirName} {entries} />
{:else if dirCid}
  <!-- Not a yjs doc - show option to convert or simple view -->
  <div class="flex-1 flex flex-col items-center justify-center text-text-3 p-6">
    <span class="i-lucide-file-question text-4xl mb-4"></span>
    <p class="text-lg mb-2">This is not a collaborative document</p>
    <p class="text-sm mb-4">It doesn't contain a .yjs configuration file</p>
    <a href="#/" class="text-accent hover:underline">Back to home</a>
  </div>
{/if}
