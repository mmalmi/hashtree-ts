<script lang="ts">
  /**
   * DirectoryActions - empty state with upload zone and README display
   * Port of React DirectoryActions component
   */
  import { getTree, decodeAsText } from '../../store';
  import { nostrStore } from '../../nostr';
  import { routeStore, currentDirCidStore, treeRootStore, createTreesStore, directoryEntriesStore, createGitInfoStore } from '../../stores';
  import FolderActions from '../FolderActions.svelte';
  import GitRepoView from '../Git/GitRepoView.svelte';
  import ReadmePanel from './ReadmePanel.svelte';
  import MobileViewerHeader from './MobileViewerHeader.svelte';
  import { uploadFiles } from '../../stores/upload';
  import type { TreeEntry as HashTreeEntry } from 'hashtree';

  let route = $derived($routeStore);
  let rootCid = $derived($treeRootStore);
  let rootHash = $derived(rootCid?.hash ?? null);
  let currentDirCid = $derived($currentDirCidStore);
  let currentPath = $derived(route.path);
  let dirEntries = $derived($directoryEntriesStore);
  let entries = $derived(dirEntries.entries);

  let viewedNpub = $derived(route.npub);
  let currentTreeName = $derived(route.treeName);
  let userNpub = $derived($nostrStore.npub);
  let isLoggedIn = $derived($nostrStore.isLoggedIn);

  // Get current tree for visibility info
  let targetNpub = $derived(viewedNpub || userNpub);
  let treesStore = $derived(createTreesStore(targetNpub));
  let trees = $state<Array<{ name: string; visibility?: string }>>([]);

  $effect(() => {
    const store = treesStore;
    const unsub = store.subscribe(value => {
      trees = value;
    });
    return unsub;
  });

  let currentTree = $derived(currentTreeName ? trees.find(t => t.name === currentTreeName) : null);

  let canEdit = $derived(!viewedNpub || viewedNpub === userNpub || !isLoggedIn);

  // Check if this is a git repo
  let gitInfoStore = $derived(createGitInfoStore(currentDirCid));
  let gitInfo = $state<{ isRepo: boolean; currentBranch: string | null; branches: string[]; loading: boolean }>({
    isRepo: false,
    currentBranch: null,
    branches: [],
    loading: true,
  });

  $effect(() => {
    const store = gitInfoStore;
    const unsub = store.subscribe(value => {
      gitInfo = value;
    });
    return unsub;
  });
  // Show actions if we have a tree OR we're in a tree context (empty tree that hasn't been created yet)
  let hasTreeContext = $derived(rootHash !== null || (route.treeName !== null && canEdit));

  let readmeContent = $state<string | null>(null);
  let isDraggingOver = $state(false);
  let fileInputRef: HTMLInputElement | undefined = $state();

  // Find and load README.md
  $effect(() => {
    readmeContent = null;
    const readmeEntry = entries.find(
      (e: HashTreeEntry) => e.name.toLowerCase() === 'readme.md' && !e.isTree
    );
    if (!readmeEntry) return;

    let cancelled = false;
    getTree().readFile(readmeEntry.cid).then(data => {
      if (!cancelled && data) {
        const text = decodeAsText(data);
        if (text) readmeContent = text;
      }
    });
    return () => { cancelled = true; };
  });

  function openFilePicker() {
    fileInputRef?.click();
  }

  async function handleFileInputChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = input.files;
    if (files && files.length > 0) {
      await uploadFiles(files);
    }
    // Reset input so same file can be selected again
    input.value = '';
  }

  // Handle external file drop
  async function handleFileDrop(e: DragEvent) {
    e.preventDefault();
    isDraggingOver = false;
    if (!canEdit) return;

    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      await uploadFiles(files);
    }
  }

  function handleFileDragOver(e: DragEvent) {
    if (!canEdit) return;
    if (e.dataTransfer?.types.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      isDraggingOver = true;
    }
  }

  function handleFileDragLeave(e: DragEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (
      e.clientX < rect.left ||
      e.clientX > rect.right ||
      e.clientY < rect.top ||
      e.clientY > rect.bottom
    ) {
      isDraggingOver = false;
    }
  }

  // Check if should hide actions (locked unlisted/private)
  let hideActions = $derived(
    rootCid?.hash && !rootCid?.key && currentTree &&
    (currentTree.visibility === 'unlisted' || currentTree.visibility === 'private')
  );

  // Build back URL (parent directory or tree list)
  let backUrl = $derived.by(() => {
    const parts: string[] = [];
    if (route.npub && route.treeName) {
      // In a tree - go to parent dir or tree list
      if (currentPath.length > 0) {
        // In a subdirectory - go to parent
        parts.push(route.npub, route.treeName, ...currentPath.slice(0, -1));
      } else {
        // At tree root - go to tree list
        parts.push(route.npub);
      }
    }
    const linkKeySuffix = route.linkKey ? `?k=${route.linkKey}` : '';
    return '#/' + parts.map(encodeURIComponent).join('/') + linkKeySuffix;
  });

  // Get current directory name
  let currentDirName = $derived.by(() => {
    if (currentPath.length > 0) {
      return currentPath[currentPath.length - 1];
    }
    return currentTreeName || '';
  });
</script>

<!-- If this is a git repo, show GitHub-style directory listing -->
{#if gitInfo.isRepo && currentDirCid}
  <div class="flex flex-col h-full">
    <!-- Mobile header with back button and owner avatar (only on small screens) -->
    <MobileViewerHeader
      {backUrl}
      npub={viewedNpub}
      isPermalink={route.isPermalink}
      {rootCid}
      visibility={currentTree?.visibility}
      icon="i-lucide-folder-open text-warning"
      name={currentDirName}
      class="lg:hidden"
    />
    <!-- Mobile action buttons (compact version like FileBrowser) -->
    <div class="lg:hidden px-3 py-2 border-b border-surface-3 bg-surface-1">
      <FolderActions dirCid={currentDirCid} {canEdit} compact />
    </div>
    <div class="flex-1 overflow-auto p-3">
      <GitRepoView
        dirCid={currentDirCid}
        {entries}
        {canEdit}
        currentBranch={gitInfo.currentBranch}
        branches={gitInfo.branches}
      />
    </div>
  </div>
{:else}
  <div
    class="flex flex-col h-full"
    ondragover={handleFileDragOver}
    ondragleave={handleFileDragLeave}
    ondrop={handleFileDrop}
  >
    <!-- Mobile header with back button and owner avatar (only on small screens) -->
    <MobileViewerHeader
      {backUrl}
      npub={viewedNpub}
      isPermalink={route.isPermalink}
      {rootCid}
      visibility={currentTree?.visibility}
      icon="i-lucide-folder-open text-warning"
      name={currentDirName}
      class="lg:hidden"
    />
    <!-- Action buttons - hide when viewing locked unlisted/private directory -->
    {#if hasTreeContext && !hideActions}
      <!-- Mobile: compact inline actions -->
      <div class="lg:hidden px-3 py-2 border-b border-surface-3 bg-surface-1">
        <FolderActions dirCid={currentDirCid} {canEdit} compact />
      </div>
      <!-- Desktop: full actions -->
      <div class="hidden lg:block p-3 shrink-0">
        <FolderActions dirCid={currentDirCid} {canEdit} />
      </div>
    {/if}

  <!-- Upload drop zone -->
  {#if hasTreeContext && canEdit && !readmeContent}
    <div
      class="flex-1 mx-3 mb-3 flex items-center justify-center cursor-pointer transition-colors border border-surface-3 rounded-lg {isDraggingOver ? 'bg-surface-1/50' : 'hover:bg-surface-1/50'}"
      onclick={openFilePicker}
      role="button"
      tabindex="0"
      onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') openFilePicker(); }}
    >
      <div class="flex flex-col items-center text-text-3">
        <span class="i-lucide-plus text-4xl mb-2"></span>
        <span class="text-sm">Drop or click to add</span>
      </div>
      <input
        bind:this={fileInputRef}
        type="file"
        multiple
        class="hidden"
        onchange={handleFileInputChange}
      />
    </div>
  {/if}

  <!-- README.md content -->
  {#if readmeContent}
    <div class="flex-1 overflow-auto px-3 pb-3">
      <ReadmePanel content={readmeContent} {entries} {canEdit} />
    </div>
  {/if}
  </div>
{/if}
