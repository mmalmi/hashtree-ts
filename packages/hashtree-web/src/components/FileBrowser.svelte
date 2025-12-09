<script lang="ts">
  /**
   * FileBrowser - displays directory contents and tree list
   * Svelte port of the React component
   */
  import { toHex, nhashEncode, type TreeEntry as HashTreeEntry } from 'hashtree';
  import { formatBytes, getTree } from '../store';
  import { looksLikeFile } from '../utils/route';
  import { deleteEntry, moveEntry, moveToParent } from '../actions';
  import { openCreateModal, openShareModal } from '../stores/modals';
  import { uploadFiles, uploadDirectory } from '../stores/upload';
  import { recentlyChangedFiles } from '../stores/recentlyChanged';
  import { nostrStore, npubToPubkey } from '../nostr';
  import { UserRow } from './User';
  import FolderActions from './FolderActions.svelte';
  import VisibilityIcon from './VisibilityIcon.svelte';
  import { treeRootStore, routeStore, createTreesStore, type TreeEntry, currentDirCidStore } from '../stores';
  import { readFilesFromDataTransfer, hasDirectoryItems } from '../utils/directory';

  // Get icon class based on file extension
  function getFileIcon(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    switch (ext) {
      case 'jpg': case 'jpeg': case 'png': case 'gif': case 'webp': case 'svg': case 'ico': case 'bmp':
        return 'i-lucide-image';
      case 'mp4': case 'webm': case 'mkv': case 'avi': case 'mov':
        return 'i-lucide-video';
      case 'mp3': case 'wav': case 'ogg': case 'flac': case 'm4a':
        return 'i-lucide-music';
      case 'js': case 'ts': case 'jsx': case 'tsx': case 'py': case 'rb': case 'go': case 'rs': case 'c': case 'cpp': case 'h': case 'java': case 'php': case 'sh': case 'bash':
        return 'i-lucide-file-code';
      case 'json': case 'yaml': case 'yml': case 'toml': case 'xml': case 'ini': case 'env':
        return 'i-lucide-file-json';
      case 'pdf': case 'doc': case 'docx': case 'txt': case 'md': case 'markdown': case 'rst':
        return 'i-lucide-file-text';
      case 'xls': case 'xlsx': case 'csv':
        return 'i-lucide-file-spreadsheet';
      case 'ppt': case 'pptx':
        return 'i-lucide-file-presentation';
      case 'zip': case 'tar': case 'gz': case 'rar': case '7z':
        return 'i-lucide-file-archive';
      case 'html': case 'htm': case 'css': case 'scss': case 'sass': case 'less':
        return 'i-lucide-file-code';
      default:
        return 'i-lucide-file';
    }
  }

  // Build href for an entry
  function buildEntryHref(
    entry: { name: string; isTree: boolean },
    currentNpub: string | null,
    currentTreeName: string | null,
    currentPath: string[],
    rootCidForHref: { hash: Uint8Array; key?: Uint8Array } | null,
    linkKey: string | null
  ): string {
    const parts: string[] = [];
    const suffix = linkKey ? `?k=${linkKey}` : '';

    if (currentNpub && currentTreeName) {
      parts.push(currentNpub, currentTreeName);
      parts.push(...currentPath);
      parts.push(entry.name);
      return '#/' + parts.map(encodeURIComponent).join('/') + suffix;
    } else if (rootCidForHref?.hash) {
      // Include encryption key in nhash if available
      const nhash = nhashEncode({
        hash: toHex(rootCidForHref.hash),
        decryptKey: rootCidForHref.key ? toHex(rootCidForHref.key) : undefined
      });
      parts.push(nhash);
      parts.push(...currentPath);
      parts.push(entry.name);
      return '#/' + parts.map(encodeURIComponent).join('/') + suffix;
    }

    parts.push(...currentPath);
    parts.push(entry.name);
    return '#/' + parts.map(encodeURIComponent).join('/') + suffix;
  }

  // Build href for a tree (root of tree, no path)
  function buildTreeHref(ownerNpub: string, treeName: string, linkKey?: string): string {
    const base = `#/${encodeURIComponent(ownerNpub)}/${encodeURIComponent(treeName)}`;
    return linkKey ? `${base}?k=${linkKey}` : base;
  }

  let isLoggedIn = $derived($nostrStore.isLoggedIn);
  let userNpub = $derived($nostrStore.npub);
  let selectedTree = $derived($nostrStore.selectedTree);
  let route = $derived($routeStore);
  let rootCid = $derived($treeRootStore);
  let currentDirCid = $derived($currentDirCidStore);
  let recentlyChanged = $derived($recentlyChangedFiles);

  let currentNpub = $derived(route.npub);
  let currentTreeName = $derived(route.treeName);
  // Get visibility for current tree (from selectedTree if available)
  // Note: currentTreeVisibility uses effectiveTree which is derived after trees store is created
  // Get directory path (exclude file if URL points to file)
  let urlPath = $derived(route.path);
  let lastSegment = $derived(urlPath.length > 0 ? urlPath[urlPath.length - 1] : null);
  let currentPath = $derived(lastSegment && looksLikeFile(lastSegment) ? urlPath.slice(0, -1) : urlPath);
  let rootHash = $derived(rootCid?.hash ?? null);
  let linkKey = $derived(route.linkKey);

  let inTreeView = $derived(!!currentTreeName || !!rootHash);
  let viewedNpub = $derived(currentNpub);
  let isOwnTrees = $derived(!viewedNpub || viewedNpub === userNpub);
  let canEdit = $derived(isOwnTrees || !isLoggedIn);

  // Check if we have a tree hash but no decryption key (protected tree without access)
  let hasHashButNoKey = $derived(rootCid?.hash && !rootCid?.key);

  // Check if we're missing the decryption key (either no rootCid yet, or rootCid without key)
  let missingDecryptionKey = $derived(!rootCid?.key);

  // Get trees from resolver subscription
  let targetNpub = $derived(viewedNpub || userNpub);

  // Create trees store for the target user
  let treesStore = $derived(createTreesStore(targetNpub));
  let trees = $state<TreeEntry[]>([]);

  // Find the current tree in the trees list (needed for non-owners to get visibility)
  let currentTreeFromList = $derived.by(() => {
    if (!currentTreeName) return null;
    return trees.find(t => t.name === currentTreeName) || null;
  });

  // Get the effective tree info (prefer selectedTree for owner, fall back to list for non-owner)
  let effectiveTree = $derived(isOwnTrees ? selectedTree : currentTreeFromList);

  // Get visibility for current tree
  let currentTreeVisibility = $derived(effectiveTree?.visibility ?? 'public');

  // Check if we're trying to access a protected tree without proper key
  // For non-owners, we need to check if this is a protected tree even before rootCid arrives
  let isProtectedTreeWithoutAccess = $derived(
    !isOwnTrees &&
    missingDecryptionKey &&
    effectiveTree &&
    (effectiveTree.visibility === 'unlisted' || effectiveTree.visibility === 'private')
  );

  // Subscribe to trees store
  $effect(() => {
    const store = treesStore;
    const unsub = store.subscribe(value => {
      trees = value;
    });
    return unsub;
  });

  // Sort trees: public, link, private first, then alphabetically
  let sortedTrees = $derived(
    isOwnTrees
      ? [...trees].sort((a, b) => {
          const defaultFolderOrder = ['public', 'link', 'private'];
          const aIdx = defaultFolderOrder.indexOf(a.name);
          const bIdx = defaultFolderOrder.indexOf(b.name);
          if (aIdx >= 0 && bIdx >= 0) return aIdx - bIdx;
          if (aIdx >= 0) return -1;
          if (bIdx >= 0) return 1;
          return a.name.localeCompare(b.name);
        })
      : trees
  );

  // Directory entries - fetch from tree
  let entries = $state<HashTreeEntry[]>([]);
  let isDirectory = $state(true);

  // Fetch directory entries when currentDirCid changes
  $effect(() => {
    const cid = currentDirCid;
    if (!cid) {
      entries = [];
      isDirectory = true;
      return;
    }

    const tree = getTree();

    // Sort entries: directories first, then alphabetically
    function sortEntries(list: HashTreeEntry[]): HashTreeEntry[] {
      return [...list].sort((a, b) => {
        if (a.isTree !== b.isTree) return a.isTree ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    }

    if (cid.key) {
      // Encrypted - try to list directory with key
      tree.listDirectory(cid).then(list => {
        entries = sortEntries(list);
        isDirectory = true;
      }).catch(() => {
        entries = [];
        isDirectory = false;
      });
    } else {
      // Public - first check if it's a directory
      tree.isDirectory(cid).then(isDir => {
        isDirectory = isDir;
        if (isDir) {
          return tree.listDirectory(cid).then(list => {
            entries = sortEntries(list);
          });
        } else {
          entries = [];
        }
      }).catch(() => {
        entries = [];
        isDirectory = true;
      });
    }
  });

  let isDraggingOver = $state(false);
  let fileListRef: HTMLDivElement | undefined = $state();

  // Handle external file drop
  async function handleFileDrop(e: DragEvent) {
    e.preventDefault();
    isDraggingOver = false;
    if (!canEdit) return;

    const dataTransfer = e.dataTransfer;
    if (!dataTransfer) return;

    if (hasDirectoryItems(dataTransfer) || dataTransfer.items?.length > 0) {
      const result = await readFilesFromDataTransfer(dataTransfer);
      if (result.files.length > 0) {
        await uploadDirectory(result);
        return;
      }
    }

    const files = dataTransfer.files;
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
    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    if (
      e.clientX < rect.left ||
      e.clientX > rect.right ||
      e.clientY < rect.top ||
      e.clientY > rect.bottom
    ) {
      isDraggingOver = false;
    }
  }

  function buildDirHref(path: string[]): string {
    const parts: string[] = [];
    const suffix = linkKey ? `?k=${linkKey}` : '';

    if (currentNpub && currentTreeName) {
      parts.push(currentNpub, currentTreeName);
      parts.push(...path);
      return '#/' + parts.map(encodeURIComponent).join('/') + suffix;
    } else if (rootCid?.hash) {
      // Include encryption key in nhash if available
      const nhash = nhashEncode({
        hash: toHex(rootCid.hash),
        decryptKey: rootCid.key ? toHex(rootCid.key) : undefined
      });
      parts.push(nhash);
      parts.push(...path);
      return '#/' + parts.map(encodeURIComponent).join('/') + suffix;
    }

    parts.push(...path);
    return '#/' + parts.map(encodeURIComponent).join('/') + suffix;
  }

  function buildRootHref(): string {
    if (viewedNpub) return `#/${viewedNpub}`;
    return '#/';
  }

  let hasParent = $derived(currentNpub || currentPath.length > 0);
  let currentDirName = $derived(
    currentPath.length > 0
      ? currentPath[currentPath.length - 1]
      : currentTreeName || (rootCid?.hash ? nhashEncode({ hash: toHex(rootCid.hash), decryptKey: rootCid.key ? toHex(rootCid.key) : undefined }).slice(0, 16) + '...' : '')
  );

  // Get file name from URL (last segment if it's a file)
  let selectedFileName = $derived(lastSegment && looksLikeFile(lastSegment) ? lastSegment : null);

  // Find selected entry
  let selectedEntry = $derived(selectedFileName ? entries.find(e => e.name === selectedFileName) : null);
  let selectedIndex = $derived(selectedEntry ? entries.findIndex(e => e.name === selectedEntry.name) : -1);

  // Keyboard navigation state
  let focusedIndex = $state(-1);
  let treeFocusedIndex = $state(-1);

  // Navigation item counts
  let specialItemCount = $derived((hasParent ? 1 : 0) + 1); // parent? + current
  let navItemCount = $derived(specialItemCount + entries.length);

  // Auto-focus file list when view changes
  $effect(() => {
    // Track dependencies
    const _ = [inTreeView, currentTreeName, currentPath.join('/')];
    // Small delay to ensure DOM is ready after navigation
    const timer = setTimeout(() => {
      fileListRef?.focus();
    }, 50);
    return () => clearTimeout(timer);
  });

  // Keyboard navigation handler for file browser
  function handleKeyDown(e: KeyboardEvent) {
    const key = e.key.toLowerCase();

    // Handle Delete key - delete focused or selected item
    if ((key === 'delete' || key === 'backspace') && canEdit) {
      const entryIndex = focusedIndex - specialItemCount;
      const targetEntry = entryIndex >= 0 ? entries[entryIndex] : selectedEntry;
      if (targetEntry) {
        e.preventDefault();
        if (confirm(`Delete ${targetEntry.name}?`)) {
          deleteEntry(targetEntry.name);
          focusedIndex = -1;
        }
      }
      return;
    }

    // Handle Enter key - navigate to focused item
    if (key === 'enter' && focusedIndex >= 0) {
      e.preventDefault();
      if (hasParent && focusedIndex === 0) {
        // Navigate to parent
        window.location.hash = currentPath.length > 0 ? buildDirHref(currentPath.slice(0, -1)).slice(1) : buildRootHref().slice(1);
        focusedIndex = -1;
      } else if (focusedIndex === (hasParent ? 1 : 0)) {
        // Navigate to current
        window.location.hash = buildDirHref(currentPath).slice(1);
        focusedIndex = -1;
      } else {
        // Navigate to entry
        const entryIndex = focusedIndex - specialItemCount;
        const entry = entries[entryIndex];
        if (entry) {
          const href = buildEntryHref(entry, currentNpub, currentTreeName, currentPath, rootCid, linkKey);
          window.location.hash = href.slice(1);
          focusedIndex = -1;
        }
      }
      return;
    }

    if (key !== 'arrowup' && key !== 'arrowdown' && key !== 'arrowleft' && key !== 'arrowright' && key !== 'j' && key !== 'k' && key !== 'h' && key !== 'l') return;

    // Don't prevent browser back/forward navigation (Ctrl/Cmd + Arrow)
    if (e.ctrlKey || e.metaKey) return;

    e.preventDefault();

    // Start from focused index, or derive from selected entry
    let currentIndex = focusedIndex;
    if (currentIndex < 0 && selectedIndex >= 0) {
      currentIndex = selectedIndex + specialItemCount;
    }

    let newIndex: number;

    if (key === 'arrowdown' || key === 'arrowright' || key === 'j' || key === 'l') {
      newIndex = currentIndex < navItemCount - 1 ? currentIndex + 1 : 0;
    } else {
      newIndex = currentIndex > 0 ? currentIndex - 1 : navItemCount - 1;
    }

    // Check if it's a special item or entry
    if (hasParent && newIndex === 0) {
      // Parent directory - just focus
      focusedIndex = newIndex;
    } else if (newIndex === (hasParent ? 1 : 0)) {
      // Current directory - just focus
      focusedIndex = newIndex;
    } else {
      // Entry
      const entryIndex = newIndex - specialItemCount;
      const newEntry = entries[entryIndex];
      if (newEntry) {
        if (newEntry.isTree) {
          // Directory: just focus it, don't navigate
          focusedIndex = newIndex;
        } else {
          // File: navigate to it and clear focus
          focusedIndex = -1;
          const href = buildEntryHref(newEntry, currentNpub, currentTreeName, currentPath, rootCid, linkKey);
          window.location.hash = href.slice(1);
        }
      }
    }
  }

  // Keyboard navigation handler for tree list
  function handleTreeListKeyDown(e: KeyboardEvent) {
    if (sortedTrees.length === 0) return;

    const key = e.key.toLowerCase();

    // Handle Enter key - navigate to focused tree
    if (key === 'enter' && treeFocusedIndex >= 0) {
      e.preventDefault();
      const tree = sortedTrees[treeFocusedIndex];
      if (tree) {
        window.location.hash = buildTreeHref(targetNpub!, tree.name, tree.linkKey).slice(1);
        treeFocusedIndex = -1;
      }
      return;
    }

    if (key !== 'arrowup' && key !== 'arrowdown' && key !== 'j' && key !== 'k') return;

    e.preventDefault();

    // Find currently selected tree index
    const selectedTreeIndex = currentTreeName ? sortedTrees.findIndex(t => t.name === currentTreeName) : -1;
    const currentIndex = treeFocusedIndex >= 0 ? treeFocusedIndex : selectedTreeIndex;
    let newIndex: number;

    if (key === 'arrowdown' || key === 'j') {
      newIndex = currentIndex < sortedTrees.length - 1 ? currentIndex + 1 : 0;
    } else {
      newIndex = currentIndex > 0 ? currentIndex - 1 : sortedTrees.length - 1;
    }

    treeFocusedIndex = newIndex;
  }
</script>

<div class="flex-1 flex flex-col min-h-0 bg-surface-1">
  {#if !inTreeView}
    <!-- Tree list view -->
    <div class="h-10 shrink-0 px-3 border-b border-surface-3 flex items-center gap-2 bg-surface-1">
      {#if viewedNpub}
        <a href="#/{viewedNpub}/profile" class="no-underline min-w-0">
          <UserRow pubkey={npubToPubkey(viewedNpub) || viewedNpub} avatarSize={24} showBadge class="min-w-0" />
        </a>
      {:else if isLoggedIn && userNpub}
        <a href="#/{userNpub}/profile" class="no-underline min-w-0">
          <UserRow pubkey={npubToPubkey(userNpub) || userNpub} avatarSize={24} showBadge class="min-w-0" />
        </a>
      {:else}
        <span class="text-sm text-text-2">Folders</span>
      {/if}
      <button
        onclick={() => {
          const base = window.location.origin + window.location.pathname + '#';
          openShareModal(base + (viewedNpub ? `/${viewedNpub}` : '/'));
        }}
        class="ml-auto btn-ghost p-1.5"
        title="Share"
      >
        <span class="i-lucide-share"></span>
      </button>
    </div>

    {#if isOwnTrees}
      <button
        onclick={() => openCreateModal('tree')}
        class="shrink-0 mx-3 mt-3 btn-ghost border border-dashed border-surface-3 flex items-center justify-center gap-2 py-3 text-sm text-text-2 hover:text-text-1 hover:border-accent"
      >
        <span class="i-lucide-folder-plus"></span>
        New Folder
      </button>
    {/if}

    <div
      bind:this={fileListRef}
      data-testid="file-list"
      class="flex-1 overflow-auto pb-4 outline-none"
      tabindex="0"
      onkeydown={handleTreeListKeyDown}
    >
      {#if sortedTrees.length === 0}
        <div class="p-8 text-center text-muted">
          Add files to begin
        </div>
      {:else}
        {#each sortedTrees as tree, idx}
          <a
            href={buildTreeHref(targetNpub!, tree.name, tree.linkKey)}
            class="p-3 border-b border-surface-2 flex items-center gap-3 cursor-pointer no-underline text-text-1 min-w-0 {currentTreeName === tree.name ? 'bg-surface-2' : 'hover:bg-surface-1'} {treeFocusedIndex === idx ? 'ring-2 ring-inset ring-accent' : ''}"
          >
            <span class="shrink-0 i-lucide-folder text-warning"></span>
            <span class="truncate flex-1" title={tree.name}>{tree.name}</span>
            <VisibilityIcon visibility={tree.visibility} class="ml-auto text-text-3" />
          </a>
        {/each}
      {/if}
    </div>
  {:else}
    <!-- File browser view -->
    {#if viewedNpub}
      <div class="h-10 shrink-0 px-3 border-b border-surface-3 flex items-center gap-2 bg-surface-1">
        <a href="#/{viewedNpub}/profile" class="no-underline min-w-0">
          <UserRow pubkey={npubToPubkey(viewedNpub) || viewedNpub} avatarSize={24} showBadge class="min-w-0" />
        </a>
      </div>
    {/if}

    <!-- Mobile action buttons -->
    {#if currentDirCid || canEdit}
      <div class="lg:hidden px-3 py-2 border-b border-surface-3 bg-surface-1">
        <FolderActions dirCid={currentDirCid} {canEdit} compact />
      </div>
    {/if}

    <div
      bind:this={fileListRef}
      data-testid="file-list"
      class="flex-1 overflow-auto relative outline-none pb-4 {isDraggingOver ? 'bg-accent/10' : ''}"
      tabindex="0"
      onkeydown={handleKeyDown}
      ondragover={handleFileDragOver}
      ondragleave={handleFileDragLeave}
      ondrop={handleFileDrop}
    >
      {#if isDraggingOver}
        <div class="absolute inset-0 flex items-center justify-center pointer-events-none z-10 border-2 border-dashed border-accent rounded m-2">
          <span class="text-accent font-medium">Drop files to add</span>
        </div>
      {/if}

      <!-- Parent directory row -->
      {#if hasParent}
        <a
          href={currentPath.length > 0 ? buildDirHref(currentPath.slice(0, -1)) : buildRootHref()}
          class="p-3 border-b border-surface-2 flex items-center gap-3 no-underline text-text-1 hover:bg-surface-2/50 {focusedIndex === 0 ? 'ring-2 ring-inset ring-accent' : ''}"
        >
          <span class="i-lucide-folder text-warning shrink-0"></span>
          <span class="truncate">..</span>
        </a>
      {/if}

      <!-- Current directory row -->
      <a
        href={buildDirHref(currentPath)}
        class="p-3 border-b border-surface-2 flex items-center gap-3 no-underline text-text-1 hover:bg-surface-2/50 {!selectedEntry && focusedIndex < 0 ? 'bg-surface-2' : ''} {focusedIndex === (hasParent ? 1 : 0) ? 'ring-2 ring-inset ring-accent' : ''}"
      >
        <span class="shrink-0 i-lucide-folder-open text-warning"></span>
        <span class="truncate flex-1">{currentDirName}</span>
        {#if currentPath.length === 0}
          {#if route.isPermalink}
            <!-- Permalink view: show link-lock if has key, globe if no key -->
            {#if rootCid?.key}
              <span class="relative inline-block shrink-0 text-text-2" title="Encrypted (has key)">
                <span class="i-lucide-link"></span>
                <span class="i-lucide-lock absolute -bottom-0.5 -right-1.5 text-[0.6em]"></span>
              </span>
            {:else}
              <span class="i-lucide-globe text-text-2" title="Public"></span>
            {/if}
          {:else}
            <VisibilityIcon visibility={currentTreeVisibility} class="text-text-2" />
          {/if}
        {/if}
      </a>

      {#if isProtectedTreeWithoutAccess}
        <!-- Protected tree without access - show appropriate message -->
        <div class="p-8 text-center">
          <div class="inline-flex items-center justify-center mb-4">
            {#if effectiveTree?.visibility === 'unlisted'}
              {#if linkKey}
                <span class="i-lucide-key-round text-3xl text-danger"></span>
              {:else}
                <span class="relative inline-block shrink-0 text-3xl text-text-3">
                  <span class="i-lucide-link"></span>
                  <span class="i-lucide-lock absolute -bottom-0.5 -right-1.5 text-[0.6em]"></span>
                </span>
              {/if}
            {:else}
              <span class="i-lucide-lock text-3xl text-text-3"></span>
            {/if}
          </div>
          <div class="text-text-2 font-medium mb-2">
            {#if effectiveTree?.visibility === 'unlisted'}
              {linkKey ? 'Invalid Link Key' : 'Link Required'}
            {:else}
              Private Folder
            {/if}
          </div>
          <div class="text-text-3 text-sm max-w-xs mx-auto">
            {#if effectiveTree?.visibility === 'unlisted'}
              {linkKey
                ? 'The link key provided is invalid or has expired. Ask the owner for a new link.'
                : 'This folder requires a special link to access. Ask the owner for the link with the access key.'}
            {:else}
              This folder is private and can only be accessed by its owner.
            {/if}
          </div>
        </div>
      {:else if entries.length === 0}
        <div class="p-4 pl-6 text-center text-muted text-sm">
          {isDraggingOver ? '' : 'Empty directory'}
        </div>
      {:else}
        {#each entries as entry, idx}
          <a
            href={buildEntryHref(entry, currentNpub, currentTreeName, currentPath, rootCid, linkKey)}
            class="p-3 pl-9 border-b border-surface-2 flex items-center gap-3 no-underline text-text-1 hover:bg-surface-2/50 {selectedEntry?.name === entry.name ? 'bg-surface-2' : ''} {focusedIndex === idx + specialItemCount ? 'ring-2 ring-inset ring-accent' : ''} {recentlyChanged.has(entry.name) && selectedEntry?.name !== entry.name ? 'animate-pulse-live' : ''}"
          >
            <span class="shrink-0 {entry.isTree ? 'i-lucide-folder text-warning' : `${getFileIcon(entry.name)} text-text-2`}"></span>
            <span class="truncate flex-1 min-w-0" title={entry.name}>{entry.name}</span>
            <span class="shrink-0 text-muted text-sm min-w-12 text-right">
              {!entry.isTree && entry.size !== undefined ? formatBytes(entry.size) : ''}
            </span>
          </a>
        {/each}
      {/if}
    </div>
  {/if}
</div>
