<script lang="ts">
  /**
   * DirectoryActions - empty state with upload zone and README display
   * Port of React DirectoryActions component
   */
  import { getTree, decodeAsText } from '../../store';
  import { nostrStore } from '../../nostr';
  import { routeStore, currentDirCidStore, treeRootStore, createTreesStore, directoryEntriesStore } from '../../hooks';
  import FolderActions from '../FolderActions.svelte';
  import { uploadFiles } from '../../hooks/useUpload';
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
</script>

<div
  class="flex flex-col h-full"
  ondragover={handleFileDragOver}
  ondragleave={handleFileDragLeave}
  ondrop={handleFileDrop}
>
  <!-- Action buttons - hide when viewing locked unlisted/private directory -->
  {#if hasTreeContext && !hideActions}
    <div class="p-3 shrink-0">
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
    <div class="flex-1 overflow-auto px-4 pb-4">
      <div class="prose prose-invert max-w-none">
        {@html readmeContent}
      </div>
    </div>
  {/if}
</div>
