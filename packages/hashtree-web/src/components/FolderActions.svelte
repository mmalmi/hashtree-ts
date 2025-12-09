<script lang="ts">
  /**
   * Shared folder action buttons - used in FileBrowser and Viewer
   * Port of React FolderActions component
   */
  import { nhashEncode, toHex } from 'hashtree';
  import type { CID } from 'hashtree';
  import { openCreateModal, openRenameModal, openForkModal, openShareModal } from '../stores/modals';
  import { uploadFiles, uploadDirectory } from '../stores/upload';
  import { deleteCurrentFolder, buildRouteUrl } from '../actions';
  import { nostrStore } from '../nostr';
  import { getTree } from '../store';
  import { createZipFromDirectory, downloadBlob } from '../utils/compression';
  import { readFilesFromWebkitDirectory, supportsDirectoryUpload } from '../utils/directory';
  import { routeStore, createTreesStore } from '../stores';

  interface Props {
    dirCid?: CID | null;
    canEdit: boolean;
  }

  let { dirCid = null, canEdit }: Props = $props();

  let isDownloading = $state(false);
  let dirInputRef: HTMLInputElement | undefined = $state();

  let hasDirectorySupport = supportsDirectoryUpload();
  let route = $derived($routeStore);
  let userNpub = $derived($nostrStore.npub);

  // Get user's own trees for fork name suggestions
  let ownTreesStore = $derived(createTreesStore(userNpub));
  let ownTrees = $state<Array<{ name: string }>>([]);

  $effect(() => {
    const store = ownTreesStore;
    const unsub = store.subscribe(value => {
      ownTrees = value;
    });
    return unsub;
  });

  let ownTreeNames = $derived(ownTrees.map(t => t.name));

  // Check if we're in a subdirectory (not root)
  let isSubdir = $derived(route.path.length > 0);
  let currentDirName = $derived(isSubdir ? route.path[route.path.length - 1] : null);

  // For fork, use current dir name or tree name as suggestion
  let forkBaseName = $derived(currentDirName || route.treeName || 'folder');

  // Suggest a fork name - use dirName unless it already exists as a top-level tree
  function suggestForkName(dirName: string, existingTreeNames: string[]): string {
    if (!existingTreeNames.includes(dirName)) {
      return dirName;
    }
    // Add suffix to find unique name
    let i = 2;
    while (existingTreeNames.includes(`${dirName}-${i}`)) {
      i++;
    }
    return `${dirName}-${i}`;
  }

  // Handle fork button click
  function handleFork() {
    if (!dirCid) return;
    const suggestedName = suggestForkName(forkBaseName, ownTreeNames);
    openForkModal(dirCid, suggestedName);
  }

  // Handle download as ZIP
  async function handleDownloadZip() {
    if (!dirCid || isDownloading) return;
    isDownloading = true;
    try {
      const tree = getTree();
      const zipData = await createZipFromDirectory(tree, dirCid, forkBaseName);
      const zipName = `${forkBaseName}.zip`;
      downloadBlob(zipData, zipName, 'application/zip');
    } catch (err) {
      console.error('Failed to create ZIP:', err);
      alert('Failed to create ZIP file');
    } finally {
      isDownloading = false;
    }
  }

  // Handle file upload
  function handleFileUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files) uploadFiles(input.files);
    input.value = '';
  }

  // Handle directory upload
  function handleDirUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const result = readFilesFromWebkitDirectory(input.files);
      uploadDirectory(result);
    }
    input.value = '';
  }

  // Build stream URL - goes to directory with ?stream=1
  let streamUrl = $derived.by(() => {
    const streamQueryParams = [
      route.linkKey ? `k=${route.linkKey}` : '',
      'stream=1',
    ].filter(Boolean).join('&');
    return route.npub && route.treeName
      ? `#/${route.npub}/${route.treeName}${route.path.length ? '/' + route.path.join('/') : ''}?${streamQueryParams}`
      : null;
  });

  let btnClass = 'flex items-center gap-1 px-2 h-7 text-xs lg:px-3 lg:h-9 lg:text-sm';
</script>

{#if dirCid || canEdit}
  <div class="flex flex-row flex-wrap items-center gap-1">
    <!-- Share and permalink first -->
    {#if dirCid?.hash}
      <button
        onclick={() => {
          // Share directory URL (without any selected file)
          const base = window.location.origin + window.location.pathname + '#';
          const dirPath = buildRouteUrl(route.npub, route.treeName, route.path, undefined, route.linkKey);
          openShareModal(base + dirPath);
        }}
        class="btn-ghost {btnClass}"
        title="Share"
      >
        <span class="i-lucide-share"></span>
      </button>
      <a
        href="#/{nhashEncode({ hash: toHex(dirCid.hash), decryptKey: dirCid.key ? toHex(dirCid.key) : undefined })}"
        class="btn-ghost no-underline {btnClass}"
        title={toHex(dirCid.hash)}
        data-testid="permalink-link"
      >
        <span class={dirCid.key ? "i-lucide-link" : "i-lucide-lock"}></span>
        Permalink
      </a>
    {/if}

    <!-- Edit actions -->
    {#if canEdit}
      <label
        tabindex="0"
        class="btn-success cursor-pointer {btnClass}"
        title="Add files"
        onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') (e.currentTarget as HTMLElement).click(); }}
      >
        <span class="i-lucide-plus"></span>
        Add
        <input
          type="file"
          multiple
          onchange={handleFileUpload}
          class="hidden"
        />
      </label>

      {#if hasDirectorySupport}
        <label
          tabindex="0"
          class="btn-ghost cursor-pointer {btnClass}"
          title="Add a folder with all its contents"
          onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') (e.currentTarget as HTMLElement).click(); }}
        >
          <span class="i-lucide-folder-plus"></span>
          Add Folder
          <input
            bind:this={dirInputRef}
            type="file"
            webkitdirectory
            onchange={handleDirUpload}
            class="hidden"
          />
        </label>
      {/if}

      <button onclick={() => openCreateModal('file')} class="btn-ghost {btnClass}" title="New File">
        <span class="i-lucide-file-plus"></span>
        New File
      </button>

      <button onclick={() => openCreateModal('folder')} class="btn-ghost {btnClass}" title="New Folder">
        <span class="i-lucide-folder-plus"></span>
        New Folder
      </button>

      <button onclick={() => openCreateModal('document')} class="btn-ghost {btnClass}" title="New Document">
        <span class="i-lucide-file-text"></span>
        New Document
      </button>

      {#if streamUrl}
        <a href={streamUrl} class="btn-ghost no-underline {btnClass}" title="Stream">
          <span class="i-lucide-video"></span>
          Stream
        </a>
      {/if}

      {#if isSubdir && currentDirName}
        <button onclick={() => openRenameModal(currentDirName!)} class="btn-ghost {btnClass}" title="Rename">
          <span class="i-lucide-pencil"></span>
          Rename
        </button>
        <button
          onclick={() => {
            if (confirm(`Delete folder "${currentDirName}" and all its contents?`)) {
              deleteCurrentFolder();
            }
          }}
          class="btn-ghost text-danger {btnClass}"
          title="Delete"
        >
          <span class="i-lucide-trash-2"></span>
          Delete
        </button>
      {/if}
    {/if}

    <!-- Secondary actions: ZIP, Fork -->
    {#if dirCid}
      <button
        onclick={handleDownloadZip}
        disabled={isDownloading}
        class="btn-ghost {btnClass}"
        title="Download directory as ZIP"
      >
        <span class={isDownloading ? "i-lucide-loader-2 animate-spin" : "i-lucide-archive"}></span>
        {isDownloading ? 'Zipping...' : 'ZIP'}
      </button>
      <button onclick={handleFork} class="btn-ghost {btnClass}" title="Fork as new top-level folder">
        <span class="i-lucide-git-fork"></span>
        Fork
      </button>
    {/if}
  </div>
{/if}
