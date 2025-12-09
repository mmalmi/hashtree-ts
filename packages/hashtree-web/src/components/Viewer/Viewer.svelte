<script lang="ts">
  /**
   * Viewer - main file viewer component
   * Port of React Viewer component
   */
  import { toHex, nhashEncode } from 'hashtree';
  import { routeStore, treeRootStore, currentDirCidStore, directoryEntriesStore, currentHash, createTreesStore, addRecent, isViewingFileStore, recentlyChangedFiles } from '../../stores';
  import { getTree, decodeAsText, formatBytes } from '../../store';
  import { nostrStore, npubToPubkey } from '../../nostr';
  import { deleteEntry } from '../../actions';
  import { openRenameModal, openShareModal } from '../../stores/modals';
  import DirectoryActions from './DirectoryActions.svelte';
  import FileEditor from './FileEditor.svelte';
  import HtmlViewer from './HtmlViewer.svelte';
  import LiveVideoViewer from './LiveVideoViewer.svelte';
  import YjsDocumentEditor from './YjsDocumentEditor.svelte';
  import ZipPreview from './ZipPreview.svelte';
  import DosBox from './DosBox.svelte';
  import { Avatar } from '../User';
  import VisibilityIcon from '../VisibilityIcon.svelte';

  let route = $derived($routeStore);
  let rootCid = $derived($treeRootStore);
  let currentDirCid = $derived($currentDirCidStore);
  let dirEntries = $derived($directoryEntriesStore);
  let entries = $derived(dirEntries.entries);
  let hash = $derived($currentHash);

  // Check if user can edit (owns the tree or is not viewing another user's tree)
  let userNpub = $derived($nostrStore.npub);
  let isLoggedIn = $derived($nostrStore.isLoggedIn);
  let viewedNpub = $derived(route.npub);
  let canEdit = $derived(!viewedNpub || viewedNpub === userNpub || !isLoggedIn);

  // Get current tree for visibility info
  let targetNpub = $derived(viewedNpub || userNpub);
  let treesStore = $derived(createTreesStore(targetNpub));
  let trees = $derived($treesStore);
  let currentTreeName = $derived(route.treeName);
  let currentTree = $derived(currentTreeName ? trees.find(t => t.name === currentTreeName) : null);

  // Get filename from URL path - uses actual isDirectory check from hashtree
  let urlPath = $derived(route.path);
  let lastSegment = $derived(urlPath.length > 0 ? urlPath[urlPath.length - 1] : null);
  // Don't treat .yjs files as viewable files - they are internal to Yjs documents
  let isViewingFile = $derived($isViewingFileStore);
  let hasFile = $derived(isViewingFile && lastSegment && !lastSegment.endsWith('.yjs'));
  let urlFileName = $derived(hasFile ? lastSegment : null);

  // Parse query params from URL hash - use currentHash store for reactivity
  let searchParams = $derived.by(() => {
    const qIdx = hash.indexOf('?');
    if (qIdx === -1) return new URLSearchParams();
    return new URLSearchParams(hash.slice(qIdx + 1));
  });

  let isEditing = $derived(searchParams.get('edit') === '1');

  // Find entry in current entries list, or create synthetic entry for file permalinks
  let entryFromStore = $derived.by(() => {
    if (!urlFileName) return null;

    // First try to find the file in entries (works for files within directories)
    const fromEntries = entries.find(e => e.name === urlFileName && !e.isTree);
    if (fromEntries) return fromEntries;

    // For direct file permalinks (no directory listing), the rootCid IS the file's CID
    // Create a synthetic entry since there's no directory listing
    if (route.isPermalink && rootCid && entries.length === 0) {
      return {
        name: urlFileName,
        cid: rootCid,
        size: 0,
        isTree: false,
      };
    }

    return null;
  });

  // Get files only (no directories) for prev/next navigation
  let filesOnly = $derived(entries.filter(e => !e.isTree));
  let currentFileIndex = $derived(urlFileName ? filesOnly.findIndex(e => e.name === urlFileName) : -1);
  // Wrap around at start/end
  let prevFile = $derived(
    filesOnly.length > 1 && currentFileIndex >= 0
      ? filesOnly[(currentFileIndex - 1 + filesOnly.length) % filesOnly.length]
      : null
  );
  let nextFile = $derived(
    filesOnly.length > 1 && currentFileIndex >= 0
      ? filesOnly[(currentFileIndex + 1) % filesOnly.length]
      : null
  );

  // Navigate to a file in the same directory
  function navigateToFile(fileName: string) {
    const dirPath = route.path.slice(0, -1); // Remove current filename
    const parts: string[] = [];
    if (route.npub && route.treeName) {
      parts.push(route.npub, route.treeName, ...dirPath, fileName);
    }
    const linkKeySuffix = route.linkKey ? `?k=${route.linkKey}` : '';
    window.location.hash = '/' + parts.map(encodeURIComponent).join('/') + linkKeySuffix;
  }

  // Check if we have a tree context (for showing actions)
  let hasTreeContext = $derived(!!rootCid || !!route.treeName);

  // Check if current directory is a Yjs document (contains .yjs file)
  let isYjsDocument = $derived(entries.some(e => e.name === '.yjs' && !e.isTree));

  // Get current directory name from path
  let currentDirName = $derived.by(() => {
    const pathSegments = route.path;
    return pathSegments.length > 0 ? pathSegments[pathSegments.length - 1] : route.treeName || 'Document';
  });

  // File content state - raw binary data
  let fileData = $state<Uint8Array | null>(null);
  // Decoded text content (null if binary)
  let fileContent = $state<string | null>(null);
  let loading = $state(false);
  // Only show loading indicator after 2 seconds (avoid flash for fast loads)
  let showLoading = $state(false);
  let loadingTimer: ReturnType<typeof setTimeout> | null = null;
  // Blob URL for binary content (images, etc)
  let blobUrl = $state<string | null>(null);
  // Track current blob URL outside of reactive system for cleanup
  let currentBlobUrl: string | null = null;

  // Fullscreen mode - check URL param
  let isFullscreen = $derived.by(() => {
    const qIdx = hash.indexOf('?');
    if (qIdx === -1) return false;
    const params = new URLSearchParams(hash.slice(qIdx + 1));
    return params.get('fullscreen') === '1';
  });

  function toggleFullscreen() {
    const currentHash = window.location.hash;
    if (isFullscreen) {
      // Remove fullscreen param
      const newHash = currentHash
        .replace(/[?&]fullscreen=1/g, '')
        .replace(/\?$/, '')
        .replace(/\?&/, '?');
      window.location.hash = newHash;
    } else {
      // Add fullscreen param
      const hasQuery = currentHash.includes('?');
      window.location.hash = hasQuery ? `${currentHash}&fullscreen=1` : `${currentHash}?fullscreen=1`;
    }
  }

  // MIME type detection
  function getMimeType(filename?: string): string | null {
    if (!filename) return null;
    const ext = filename.split('.').pop()?.toLowerCase();
    const mimeTypes: Record<string, string> = {
      // Images
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      avif: 'image/avif',
      svg: 'image/svg+xml',
      ico: 'image/x-icon',
      bmp: 'image/bmp',
      // PDF
      pdf: 'application/pdf',
      // Audio
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      flac: 'audio/flac',
      m4a: 'audio/mp4',
      ogg: 'audio/ogg',
    };
    return ext ? mimeTypes[ext] || null : null;
  }

  // Helper to clean up blob URL
  function cleanupBlobUrl() {
    if (currentBlobUrl) {
      URL.revokeObjectURL(currentBlobUrl);
      currentBlobUrl = null;
    }
  }

  // Load file content when entry changes
  $effect(() => {
    // Clean up previous blob URL (use non-reactive variable)
    cleanupBlobUrl();

    // Clear loading timer
    if (loadingTimer) {
      clearTimeout(loadingTimer);
      loadingTimer = null;
    }

    fileData = null;
    fileContent = null;
    blobUrl = null;
    loading = false;
    showLoading = false;

    const entry = entryFromStore;
    if (!entry) return;

    // Skip loading for video files - they stream separately
    // Skip loading for DOS executables - they use their own loader
    if (isVideo || isDos) return;

    loading = true;
    let cancelled = false;

    // Show loading indicator only after 2 seconds delay
    loadingTimer = setTimeout(() => {
      if (!cancelled && loading) {
        showLoading = true;
      }
    }, 2000);

    getTree().readFile(entry.cid).then(data => {
      if (!cancelled && data) {
        fileData = data;
        // Try to decode as text
        const text = decodeAsText(data);
        fileContent = text;

        // If not text, create blob URL for binary viewing
        if (text === null && urlFileName) {
          const mimeType = getMimeType(urlFileName);
          if (mimeType) {
            const blob = new Blob([data], { type: mimeType });
            const newUrl = URL.createObjectURL(blob);
            currentBlobUrl = newUrl;
            blobUrl = newUrl;
          }
        }
      }
      loading = false;
      showLoading = false;
      if (loadingTimer) {
        clearTimeout(loadingTimer);
        loadingTimer = null;
      }
    }).catch(() => {
      loading = false;
      showLoading = false;
      if (loadingTimer) {
        clearTimeout(loadingTimer);
        loadingTimer = null;
      }
    });

    return () => {
      cancelled = true;
      cleanupBlobUrl();
      if (loadingTimer) {
        clearTimeout(loadingTimer);
        loadingTimer = null;
      }
    };
  });

  // Track file visits in recents
  $effect(() => {
    if (!urlFileName || !route.npub || !route.treeName) return;

    // Build full path for the file
    const pathParts = route.path.join('/');
    const fullPath = `/${route.npub}/${route.treeName}${pathParts ? '/' + pathParts : ''}`;

    addRecent({
      type: 'file',
      label: urlFileName,
      path: fullPath,
      npub: route.npub,
      treeName: route.treeName,
    });
  });

  function exitEditMode() {
    // Remove ?edit=1 from URL
    const hashBase = window.location.hash.split('?')[0];
    const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
    params.delete('edit');
    const queryString = params.toString();
    window.location.hash = queryString ? `${hashBase}?${queryString}` : hashBase;
  }

  function enterEditMode() {
    // Add ?edit=1 to URL
    const hashBase = window.location.hash.split('?')[0];
    const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
    params.set('edit', '1');
    window.location.hash = `${hashBase}?${params.toString()}`;
  }

  function handleDelete() {
    if (!entryFromStore) return;
    if (confirm(`Delete ${entryFromStore.name}?`)) {
      deleteEntry(entryFromStore.name);
      // Navigate back to directory
      const dirPath = route.path.slice(0, -1);
      const parts: string[] = [];
      if (route.npub && route.treeName) {
        parts.push(route.npub, route.treeName, ...dirPath);
      }
      const linkKeySuffix = route.linkKey ? `?k=${route.linkKey}` : '';
      window.location.hash = '#/' + parts.map(encodeURIComponent).join('/') + linkKeySuffix;
    }
  }

  // Keyboard navigation for file viewing
  $effect(() => {
    if (!entryFromStore && !urlFileName) return; // Only when viewing a file
    if (isEditing) return; // Don't navigate when editing
    if (isDos) return; // Don't interfere with DOSBox keyboard input

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't interfere with browser shortcuts (Cmd/Ctrl + arrows)
      if (e.metaKey || e.ctrlKey) return;
      // Don't interfere when focus is in input/textarea/canvas
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'CANVAS' || target.isContentEditable) return;

      const key = e.key.toLowerCase();

      // Escape: back to directory
      if (key === 'escape') {
        e.preventDefault();
        (document.activeElement as HTMLElement)?.blur();
        window.location.hash = backUrl.slice(1); // Remove leading #
        return;
      }

      // j/k/ArrowDown/ArrowUp: next/prev file (vertical navigation)
      // l/ArrowRight: next file (horizontal navigation)
      if ((key === 'j' || key === 'arrowdown' || key === 'l' || key === 'arrowright') && nextFile) {
        e.preventDefault();
        navigateToFile(nextFile.name);
        return;
      }

      // k/ArrowUp/h/ArrowLeft: prev file
      if ((key === 'k' || key === 'arrowup' || key === 'h' || key === 'arrowleft') && prevFile) {
        e.preventDefault();
        navigateToFile(prevFile.name);
        return;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  });

  // Check if file looks like text based on extension
  function isLikelyTextFile(filename: string): boolean {
    const textExtensions = ['txt', 'md', 'json', 'js', 'ts', 'jsx', 'tsx', 'css', 'scss', 'html', 'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'sh', 'bash', 'py', 'rb', 'go', 'rs', 'c', 'cpp', 'h', 'hpp', 'java', 'php', 'sql', 'svelte', 'vue'];
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    return textExtensions.includes(ext);
  }

  let isTextFile = $derived(urlFileName ? isLikelyTextFile(urlFileName) : false);

  // Check if file is HTML (should be rendered in iframe)
  function isHtmlFile(filename: string): boolean {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    return ext === 'html' || ext === 'htm';
  }

  let isHtml = $derived(urlFileName ? isHtmlFile(urlFileName) : false);

  // Check if file is a video
  function isVideoFile(filename: string): boolean {
    const videoExtensions = ['mp4', 'webm', 'ogg', 'ogv', 'mov', 'avi', 'mkv'];
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    return videoExtensions.includes(ext);
  }

  let isVideo = $derived(urlFileName ? isVideoFile(urlFileName) : false);

  // Check if file is an image
  function isImageFile(filename: string): boolean {
    const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'ico', 'bmp'];
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    return imageExtensions.includes(ext);
  }

  let isImage = $derived(urlFileName ? isImageFile(urlFileName) : false);

  // Check if file is audio
  function isAudioFile(filename: string): boolean {
    const audioExtensions = ['mp3', 'wav', 'flac', 'm4a', 'ogg', 'aac'];
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    return audioExtensions.includes(ext);
  }

  let isAudio = $derived(urlFileName ? isAudioFile(urlFileName) : false);

  // Check if file is PDF
  function isPdfFile(filename: string): boolean {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    return ext === 'pdf';
  }

  let isPdf = $derived(urlFileName ? isPdfFile(urlFileName) : false);

  // Check if file is ZIP archive
  function isZipFile(filename: string): boolean {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    return ext === 'zip';
  }

  let isZip = $derived(urlFileName ? isZipFile(urlFileName) : false);

  // Check if file is DOS executable
  function isDosExecutable(filename: string): boolean {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    return ext === 'exe' || ext === 'com' || ext === 'bat';
  }

  let isDos = $derived(urlFileName ? isDosExecutable(urlFileName) : false);

  // Check if file is a live stream
  // Shows LIVE indicator when:
  // 1. URL has ?live=1 param, OR
  // 2. File was recently changed AND viewing someone else's tree (not own files)
  let recentlyChanged = $derived($recentlyChangedFiles);
  let isLiveStream = $derived.by(() => {
    // Check URL param first
    const hashPart = window.location.hash;
    const queryIndex = hashPart.indexOf('?');
    if (queryIndex !== -1) {
      const params = new URLSearchParams(hashPart.slice(queryIndex + 1));
      if (params.get('live') === '1') return true;
    }

    // Show LIVE for files recently changed by others (not our own uploads)
    // Only applies when viewing another user's tree
    if (urlFileName && viewedNpub && viewedNpub !== userNpub && recentlyChanged.has(urlFileName)) {
      return true;
    }

    return false;
  });

  // Build permalink URL for the current file
  let permalinkUrl = $derived.by(() => {
    if (!entryFromStore?.cid?.hash) return null;
    const hashHex = toHex(entryFromStore.cid.hash);
    const keyHex = entryFromStore.cid.key ? toHex(entryFromStore.cid.key) : undefined;
    const nhash = nhashEncode({ hash: hashHex, decryptKey: keyHex });
    return `#/${nhash}/${encodeURIComponent(entryFromStore.name)}`;
  });

  // Build back URL (directory without file)
  let backUrl = $derived.by(() => {
    const dirPath = route.path.slice(0, -1);
    const parts: string[] = [];
    if (route.npub && route.treeName) {
      parts.push(route.npub, route.treeName, ...dirPath);
    }
    const linkKeySuffix = route.linkKey ? `?k=${route.linkKey}` : '';
    return '#/' + parts.map(encodeURIComponent).join('/') + linkKeySuffix;
  });

  // Get file icon based on extension
  function getFileIcon(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    const iconMap: Record<string, string> = {
      // Images
      png: 'i-lucide-image',
      jpg: 'i-lucide-image',
      jpeg: 'i-lucide-image',
      gif: 'i-lucide-image',
      webp: 'i-lucide-image',
      svg: 'i-lucide-image',
      // Video
      mp4: 'i-lucide-video',
      webm: 'i-lucide-video',
      mov: 'i-lucide-video',
      // Audio
      mp3: 'i-lucide-music',
      wav: 'i-lucide-music',
      flac: 'i-lucide-music',
      // Code
      js: 'i-lucide-file-code',
      ts: 'i-lucide-file-code',
      jsx: 'i-lucide-file-code',
      tsx: 'i-lucide-file-code',
      py: 'i-lucide-file-code',
      rs: 'i-lucide-file-code',
      go: 'i-lucide-file-code',
      // Documents
      md: 'i-lucide-file-text',
      txt: 'i-lucide-file-text',
      pdf: 'i-lucide-file-text',
      // Archive
      zip: 'i-lucide-archive',
      tar: 'i-lucide-archive',
      gz: 'i-lucide-archive',
    };
    return iconMap[ext] || 'i-lucide-file';
  }

  let fileIcon = $derived(urlFileName ? getFileIcon(urlFileName) : 'i-lucide-file');

  // Download handler - uses streaming when File System Access API is available
  async function handleDownload() {
    if (!entryFromStore) return;

    const tree = getTree();
    const mimeType = getMimeType(urlFileName || '') || 'application/octet-stream';
    const fileName = entryFromStore.name;

    // Try streaming download with File System Access API (Chrome/Edge)
    if ('showSaveFilePicker' in window) {
      try {
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: fileName,
          types: [{
            description: 'File',
            accept: { [mimeType]: ['.' + (fileName.split('.').pop() || '')] },
          }],
        });
        const writable = await handle.createWritable();

        // Stream from hashtree directly to file
        for await (const chunk of tree.readFileStream(entryFromStore.cid)) {
          await writable.write(chunk);
        }
        await writable.close();
        return;
      } catch (err: any) {
        // User cancelled or API failed - fall back to blob method
        if (err.name === 'AbortError') return;
        console.warn('File System Access API failed, falling back to blob:', err);
      }
    }

    // Fallback: buffer entire file (required for browsers without File System Access API)
    let data = fileData;
    if (!data) {
      data = await tree.readFile(entryFromStore.cid);
    }
    if (!data) return;

    const blob = new Blob([data], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Share handler
  function handleShare() {
    // Strip ?edit=1 from URL when sharing
    let url = window.location.href;
    url = url.replace(/[?&]edit=1/, '');
    openShareModal(url);
  }
</script>

{#if urlFileName && isEditing}
  <!-- Edit mode - show even if entry not found yet (newly created file) -->
  <FileEditor
    fileName={urlFileName}
    initialContent={fileContent || ''}
    onDone={exitEditMode}
  />
{:else if urlFileName && entryFromStore}
  <!-- File view - show content -->
  <div class="flex-1 flex flex-col min-h-0 bg-surface-0">
    <!-- Header -->
    <div class="shrink-0 px-3 py-2 border-b border-surface-3 flex flex-wrap items-center justify-between gap-2 bg-surface-1" data-testid="viewer-header">
      <div class="flex items-center gap-2 min-w-0">
        <a href={backUrl} class="btn-ghost p-1 no-underline" title="Back to folder" data-testid="viewer-back">
          <span class="i-lucide-chevron-left text-lg"></span>
        </a>
        <!-- Avatar (for npub routes) or LinkLock/globe (for nhash routes) -->
        {#if viewedNpub}
          <a href="#/{viewedNpub}/profile" class="shrink-0">
            <Avatar pubkey={npubToPubkey(viewedNpub) || ''} size={20} />
          </a>
        {:else if route.isPermalink}
          {#if rootCid?.key}
            <!-- LinkLockIcon for encrypted permalink -->
            <span class="relative inline-block shrink-0 text-text-2" title="Encrypted permalink">
              <span class="i-lucide-link"></span>
              <span class="i-lucide-lock absolute -bottom-0.5 -right-1.5 text-[0.6em]"></span>
            </span>
          {:else}
            <span class="i-lucide-globe text-text-2 shrink-0" title="Public permalink"></span>
          {/if}
        {/if}
        <!-- Visibility icon (for trees) -->
        {#if currentTree}
          <VisibilityIcon visibility={currentTree.visibility} class="text-text-2" />
        {/if}
        <!-- File type icon -->
        <span class="{fileIcon} text-text-2 shrink-0"></span>
        <span class="font-medium text-text-1 truncate">{entryFromStore.name}</span>
        {#if isLiveStream}
          <span class="ml-2 px-1.5 py-0.5 text-xs font-bold bg-red-600 text-white rounded animate-pulse">LIVE</span>
        {/if}
      </div>
      <div class="flex items-center gap-1 flex-wrap">
        <button onclick={handleDownload} class="btn-ghost" title="Download file" data-testid="viewer-download" disabled={loading && !isVideo}>
          Download
        </button>
        {#if permalinkUrl}
          <a href={permalinkUrl} class="btn-ghost no-underline" title={entryFromStore?.cid?.hash ? toHex(entryFromStore.cid.hash) : ''} data-testid="viewer-permalink">
            Permalink
          </a>
        {/if}
        <button onclick={toggleFullscreen} class="btn-ghost" title={isFullscreen ? "Exit fullscreen" : "Fullscreen"} data-testid="viewer-fullscreen">
          <span class={isFullscreen ? "i-lucide-minimize text-base" : "i-lucide-maximize text-base"}></span>
        </button>
        <button onclick={handleShare} class="btn-ghost" title="Share" data-testid="viewer-share">
          <span class="i-lucide-share text-base"></span>
        </button>
        {#if canEdit}
          <button onclick={() => openRenameModal(entryFromStore.name)} class="btn-ghost" data-testid="viewer-rename">Rename</button>
          {#if isTextFile && !isHtml}
            <button
              onclick={enterEditMode}
              class="btn-ghost"
              disabled={loading || fileContent === null}
              data-testid="viewer-edit"
            >
              Edit
            </button>
          {/if}
          <button onclick={handleDelete} class="btn-ghost text-danger" data-testid="viewer-delete">Delete</button>
        {/if}
        <!-- Prev/Next file navigation - mobile only -->
        {#if filesOnly.length > 1 && prevFile && nextFile}
          <button
            onclick={() => navigateToFile(prevFile.name)}
            class="btn-ghost lg:hidden"
            title={`Previous: ${prevFile.name}`}
          >
            <span class="i-lucide-chevron-left text-base"></span>
          </button>
          <button
            onclick={() => navigateToFile(nextFile.name)}
            class="btn-ghost lg:hidden"
            title={`Next: ${nextFile.name}`}
          >
            <span class="i-lucide-chevron-right text-base"></span>
          </button>
        {/if}
      </div>
    </div>

    <!-- Content -->
    {#if isVideo && entryFromStore?.cid}
      <!-- Key by filename to prevent remount on CID change during live streaming -->
      {#key urlFileName}
        <LiveVideoViewer cid={entryFromStore.cid} fileName={urlFileName} />
      {/key}
    {:else if isHtml && fileContent !== null}
      <HtmlViewer content={fileContent} fileName={urlFileName} />
    {:else if isImage && blobUrl}
      <!-- Image viewer -->
      <div class="flex-1 flex items-center justify-center overflow-auto bg-surface-0 p-4">
        <img
          src={blobUrl}
          alt={urlFileName}
          class="max-w-full max-h-full object-contain"
          data-testid="image-viewer"
        />
      </div>
    {:else if isAudio && blobUrl}
      <!-- Audio player -->
      <div class="flex-1 flex items-center justify-center p-4">
        <audio src={blobUrl} controls class="w-full max-w-md" />
      </div>
    {:else if isPdf && blobUrl}
      <!-- PDF viewer -->
      <iframe
        src={blobUrl}
        class="flex-1 w-full border-none"
        title={urlFileName}
      />
    {:else if isZip && fileData}
      <!-- ZIP preview -->
      <ZipPreview data={fileData} filename={urlFileName} onDownload={handleDownload} />
    {:else if isDos && currentDirCid}
      <!-- DOS executable - show DOSBox viewer -->
      <DosBox directoryCid={currentDirCid} exeName={urlFileName} />
    {:else}
      <div class="flex-1 overflow-auto p-4">
        {#if showLoading}
          <p class="text-muted animate-fade-in" data-testid="loading-indicator">Loading...</p>
        {:else if fileContent !== null}
          <pre class="text-sm text-text-1 font-mono whitespace-pre-wrap break-words">{fileContent}</pre>
        {:else if !loading && entryFromStore}
          <!-- Binary/unsupported format fallback - show download pane -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="w-full h-full p-3">
            <div
              class="w-full h-full flex flex-col items-center justify-center text-accent cursor-pointer hover:bg-accent/10 transition-colors border border-accent/50 rounded-lg"
              onclick={handleDownload}
            >
              <span class="i-lucide-download text-4xl mb-2"></span>
              <span class="text-sm mb-1">{urlFileName}</span>
              {#if entryFromStore.size}
                <span class="text-xs text-text-2">{formatBytes(entryFromStore.size)}</span>
              {/if}
            </div>
          </div>
        {/if}
      </div>
    {/if}
  </div>
{:else if hasTreeContext && isYjsDocument && currentDirCid}
  <!-- Yjs Document view - show Tiptap editor -->
  <YjsDocumentEditor
    dirCid={currentDirCid}
    dirName={currentDirName}
    entries={entries}
  />
{:else if hasTreeContext}
  <!-- Directory view - show DirectoryActions -->
  <div class="flex-1 flex flex-col min-h-0 bg-surface-0">
    <DirectoryActions />
  </div>
{:else}
  <!-- No content view -->
  <div class="flex-1 flex items-center justify-center bg-surface-0 text-muted">
    <span>Select a file to view</span>
  </div>
{/if}

