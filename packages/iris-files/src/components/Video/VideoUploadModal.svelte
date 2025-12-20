<script lang="ts">
  /**
   * VideoUploadModal - Upload video files with metadata or record from camera
   * Supports single video upload, batch upload from yt-dlp directories, and camera recording
   */
  import { SvelteSet } from 'svelte/reactivity';
  import { modalsStore, type VideoUploadTab } from '../../stores/modals/store';
  import { closeVideoUploadModal, setVideoUploadTab } from '../../stores/modals/other';
  import { nostrStore, saveHashtree } from '../../nostr';
  import { toHex, videoChunker, cid, type CID } from 'hashtree';
  import { getTree } from '../../store';
  import { addRecent } from '../../stores/recents';
  import { storeLinkKey } from '../../stores/trees';
  import { needsTranscoding, transcodeToMP4Streaming, isTranscodingSupported, canTranscode, type TranscodeProgress } from '../../utils/videoTranscode';
  import { detectYtDlpDirectory, type YtDlpVideo } from '../../utils/ytdlp';
  import VisibilitySelector from './VisibilitySelector.svelte';
  import UploadProgress from './UploadProgress.svelte';
  import BatchVideoList from './BatchVideoList.svelte';
  import {
    videoStreamStore,
    startPreview,
    stopPreview,
    startRecording,
    stopRecording,
    cancelRecording,
    formatTime,
    formatBytes,
  } from './videoStreamState';

  let showModal = $derived($modalsStore.showVideoUploadModal);
  let activeTab = $derived($modalsStore.videoUploadTab);
  let streamState = $derived($videoStreamStore);

  // Handle escape key to close modal
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && showModal && !uploading && !streamState.isRecording) {
      handleClose();
    }
  }

  $effect(() => {
    if (showModal) {
      document.addEventListener('keydown', handleKeydown);
      return () => document.removeEventListener('keydown', handleKeydown);
    }
  });

  let userNpub = $derived($nostrStore.npub);

  // Mode: 'single' for one video, 'batch' for yt-dlp directory
  let mode = $state<'select' | 'single' | 'batch'>('select');

  // ========== Upload Tab State ==========
  let fileInput: HTMLInputElement | undefined = $state();
  let folderInput: HTMLInputElement | undefined = $state();
  let selectedFile = $state<File | null>(null);
  let title = $state('');
  let description = $state('');
  let uploading = $state(false);
  let progress = $state(0);
  let progressMessage = $state('');
  let thumbnailUrl = $state<string | null>(null);
  let thumbnailBlob = $state<Blob | null>(null);
  let willTranscode = $state(false);
  let transcodeSupported = $state(true);
  let transcodeError = $state<string | null>(null);
  let visibility = $state<'public' | 'unlisted' | 'private'>('public');
  let abortController = $state<AbortController | null>(null);

  // Batch upload state
  let batchVideos = $state<YtDlpVideo[]>([]);
  let selectedVideoIds = new SvelteSet<string>();
  let channelName = $state<string>('');
  let batchCurrentIndex = $state(0);
  let batchTotalSize = $state(0);

  // Derived: selected videos for upload
  let selectedVideos = $derived(batchVideos.filter(v => selectedVideoIds.has(v.id)));

  function toggleVideo(id: string) {
    if (selectedVideoIds.has(id)) {
      selectedVideoIds.delete(id);
    } else {
      selectedVideoIds.add(id);
    }
  }

  function selectAll() {
    selectedVideoIds.clear();
    batchVideos.forEach(v => selectedVideoIds.add(v.id));
  }

  function deselectAll() {
    selectedVideoIds.clear();
  }

  // Drag state
  let isDragging = $state(false);

  // ========== Stream Tab State ==========
  let videoRef: HTMLVideoElement | undefined = $state();
  let streamTitle = $state('');
  let streamDescription = $state('');
  let streamVisibility = $state<'public' | 'unlisted' | 'private'>('public');
  let streamThumbnailUrl = $state<string | null>(null);
  let streamThumbnailBlob = $state<Blob | null>(null);
  let saving = $state(false);

  // Determine if we're busy (can't switch tabs or close)
  let isBusy = $derived(uploading || streamState.isRecording || saving);

  function handleTabChange(tab: VideoUploadTab) {
    if (isBusy) return;
    setVideoUploadTab(tab);
  }

  // ========== Upload Tab Functions ==========
  function handleFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    setupSingleVideo(file);
  }

  function setupSingleVideo(file: File) {
    mode = 'single';
    selectedFile = file;
    willTranscode = needsTranscoding(file);
    transcodeSupported = isTranscodingSupported();

    if (willTranscode) {
      const check = canTranscode(file);
      transcodeError = check.ok ? null : (check.reason || 'Cannot transcode');
    } else {
      transcodeError = null;
    }

    if (!title) {
      title = file.name.replace(/\.[^/.]+$/, '');
    }

    generateThumbnail(file);
  }

  async function handleFolderSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = input.files;
    if (!files || files.length === 0) return;
    await processFiles(Array.from(files));
  }

  async function processFiles(files: File[]) {
    // Check if it's a yt-dlp directory
    const result = detectYtDlpDirectory(files);

    if (result.isYtDlpDirectory && result.videos.length > 0) {
      // Batch mode
      mode = 'batch';
      batchVideos = result.videos;
      // Select all by default
      selectedVideoIds.clear();
      result.videos.forEach(v => selectedVideoIds.add(v.id));
      channelName = result.channelName || '';

      // Calculate total size
      let totalSize = 0;
      for (const video of result.videos) {
        if (video.videoFile) totalSize += video.videoFile.size;
        if (video.infoJson) totalSize += video.infoJson.size;
        if (video.thumbnail) totalSize += video.thumbnail.size;
      }
      batchTotalSize = totalSize;

      // If no channel name, try to extract from first video's uploader
      if (!channelName && result.videos[0]?.infoJson) {
        try {
          const text = await result.videos[0].infoJson.text();
          const data = JSON.parse(text);
          channelName = data.channel || data.uploader || '';
        } catch {}
      }
    } else if (files.length === 1 && files[0].type.startsWith('video/')) {
      // Single video file
      setupSingleVideo(files[0]);
    } else {
      // Find first video file
      const videoFile = files.find(f => f.type.startsWith('video/'));
      if (videoFile) {
        setupSingleVideo(videoFile);
      }
    }
  }

  // Drag and drop handlers
  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    isDragging = true;
  }

  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    isDragging = false;
  }

  async function handleDrop(e: DragEvent) {
    e.preventDefault();
    isDragging = false;

    if (uploading) return;

    const items = e.dataTransfer?.items;
    if (!items) return;

    const files: File[] = [];

    // Handle directory drops
    const entries: FileSystemEntry[] = [];
    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry();
      if (entry) entries.push(entry);
    }

    // Process entries recursively
    for (const entry of entries) {
      await collectFiles(entry, files);
    }

    if (files.length > 0) {
      await processFiles(files);
    }
  }

  async function collectFiles(entry: FileSystemEntry, files: File[]): Promise<void> {
    if (entry.isFile) {
      const fileEntry = entry as FileSystemFileEntry;
      const file = await new Promise<File>((resolve, reject) => {
        fileEntry.file(resolve, reject);
      });
      files.push(file);
    } else if (entry.isDirectory) {
      const dirEntry = entry as FileSystemDirectoryEntry;
      const reader = dirEntry.createReader();
      const entries = await new Promise<FileSystemEntry[]>((resolve, reject) => {
        reader.readEntries(resolve, reject);
      });
      for (const childEntry of entries) {
        await collectFiles(childEntry, files);
      }
    }
  }

  async function generateThumbnail(file: File) {
    try {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;

      const url = URL.createObjectURL(file);
      video.src = url;

      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => {
          video.currentTime = Math.min(1, video.duration / 4);
        };
        video.onseeked = () => resolve();
        video.onerror = reject;
      });

      const canvas = document.createElement('canvas');
      const maxWidth = 640;
      const maxHeight = 360;

      const videoAspect = video.videoWidth / video.videoHeight;
      let width = video.videoWidth;
      let height = video.videoHeight;

      if (width > maxWidth) {
        width = maxWidth;
        height = width / videoAspect;
      }
      if (height > maxHeight) {
        height = maxHeight;
        width = height * videoAspect;
      }

      canvas.width = Math.round(width);
      canvas.height = Math.round(height);

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const blob = await new Promise<Blob | null>(resolve => {
          canvas.toBlob(resolve, 'image/jpeg', 0.8);
        });

        if (blob) {
          thumbnailBlob = blob;
          if (thumbnailUrl) URL.revokeObjectURL(thumbnailUrl);
          thumbnailUrl = URL.createObjectURL(blob);
        }
      }

      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Failed to generate thumbnail:', e);
    }
  }

  async function handleUpload() {
    if (mode === 'batch') {
      await handleBatchUpload();
    } else {
      await handleSingleUpload();
    }
  }

  async function handleSingleUpload() {
    if (!selectedFile || !title.trim() || !userNpub) return;

    uploading = true;
    progress = 0;
    progressMessage = 'Preparing...';
    abortController = new AbortController();

    try {
      const tree = getTree();
      const treeName = `videos/${title.trim()}`;

      let videoFileName: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- CID type from hashtree
      let videoResult: { cid: any; size: number };

      const isPublic = visibility === 'public';

      if (willTranscode) {
        progressMessage = 'Loading encoder...';
        progress = 5;

        const streamWriter = tree.createStream({ public: isPublic, chunker: videoChunker() });

        const result = await transcodeToMP4Streaming(
          selectedFile,
          async (chunk: Uint8Array) => {
            await streamWriter.append(chunk);
          },
          (p: TranscodeProgress) => {
            progressMessage = p.message;
            if (p.percent !== undefined) {
              progress = 5 + Math.round(p.percent * 0.65);
            }
          },
          abortController.signal
        );

        const finalResult = await streamWriter.finalize();
        videoResult = {
          cid: { hash: finalResult.hash, key: finalResult.key },
          size: finalResult.size
        };
        videoFileName = `video.${result.extension}`;
        progress = 75;
      } else {
        progressMessage = 'Reading file...';
        progress = 10;

        const streamWriter = tree.createStream({ public: isPublic, chunker: videoChunker() });
        const chunkSize = 1024 * 1024;

        for (let offset = 0; offset < selectedFile.size; offset += chunkSize) {
          const chunk = selectedFile.slice(offset, Math.min(offset + chunkSize, selectedFile.size));
          const data = new Uint8Array(await chunk.arrayBuffer());
          await streamWriter.append(data);

          const pct = Math.round((offset / selectedFile.size) * 100);
          progressMessage = `Uploading: ${Math.round(offset / 1024 / 1024)}MB / ${Math.round(selectedFile.size / 1024 / 1024)}MB`;
          progress = 10 + Math.round(pct * 0.55);
        }

        const finalResult = await streamWriter.finalize();
        videoResult = {
          cid: { hash: finalResult.hash, key: finalResult.key },
          size: finalResult.size
        };

        const ext = selectedFile.name.split('.').pop()?.toLowerCase() || 'webm';
        videoFileName = `video.${ext}`;
        progress = 70;
      }

      progressMessage = 'Saving metadata...';
      progress = 75;

      // Prepare directory entries
      const entries: Array<{ name: string; cid: CID; size?: number }> = [
        { name: videoFileName, cid: videoResult.cid, size: videoResult.size },
      ];

      const titleData = new TextEncoder().encode(title.trim());
      const titleResult = await tree.putFile(titleData, { public: isPublic });
      entries.push({ name: 'title.txt', cid: titleResult.cid, size: titleResult.size });

      if (description.trim()) {
        const descData = new TextEncoder().encode(description.trim());
        const descResult = await tree.putFile(descData, { public: isPublic });
        entries.push({ name: 'description.txt', cid: descResult.cid, size: descResult.size });
      }
      progress = 80;

      if (thumbnailBlob) {
        const thumbData = new Uint8Array(await thumbnailBlob.arrayBuffer());
        const thumbResult = await tree.putFile(thumbData, { public: isPublic });
        entries.push({ name: 'thumbnail.jpg', cid: thumbResult.cid, size: thumbResult.size });
      }
      progress = 85;

      progressMessage = 'Creating video...';
      const dirResult = await tree.putDirectory(entries, { public: isPublic });
      progress = 90;

      progressMessage = 'Publishing...';
      const rootHash = toHex(dirResult.cid.hash);
      const rootKey = dirResult.cid.key ? toHex(dirResult.cid.key) : undefined;

      const result = await saveHashtree(treeName, rootHash, rootKey, { visibility });
      progress = 100;

      if (result.linkKey && userNpub) {
        storeLinkKey(userNpub, treeName, result.linkKey);
      }

      addRecent({
        type: 'tree',
        path: `/${userNpub}/${treeName}`,
        label: title.trim(),
        npub: userNpub,
        treeName,
        visibility,
        linkKey: result.linkKey,
      });

      uploading = false;
      progressMessage = '';
      const encodedTreeName = encodeURIComponent(treeName);
      const videoUrl = result.linkKey ? `#/${userNpub}/${encodedTreeName}?k=${result.linkKey}` : `#/${userNpub}/${encodedTreeName}`;
      window.location.hash = videoUrl;
      handleClose();
    } catch (e) {
      console.error('Upload failed:', e);
      const message = e instanceof Error ? e.message : 'Unknown error';
      if (message !== 'Cancelled') {
        alert('Failed to upload video: ' + message);
      }
      uploading = false;
      progressMessage = '';
      abortController = null;
    }
  }

  async function handleBatchUpload() {
    if (selectedVideos.length === 0 || !channelName.trim() || !userNpub) return;

    uploading = true;
    progress = 0;
    progressMessage = 'Preparing batch upload...';
    abortController = new AbortController();

    try {
      const tree = getTree();
      const treeName = `videos/${channelName.trim()}`;
      const isPublic = visibility === 'public';

      // We'll build up entries for the root directory (one per video)
      const rootEntries: Array<{ name: string; cid: CID; size: number }> = [];

      for (let i = 0; i < selectedVideos.length; i++) {
        if (abortController.signal.aborted) throw new Error('Cancelled');

        const video = selectedVideos[i];
        batchCurrentIndex = i;
        const videoProgress = (i / selectedVideos.length) * 100;
        progress = Math.round(videoProgress);
        progressMessage = `Uploading ${i + 1}/${selectedVideos.length}: ${video.title}`;

        const videoEntries: Array<{ name: string; cid: CID; size: number }> = [];

        // Upload video file
        if (video.videoFile) {
          const streamWriter = tree.createStream({ public: isPublic, chunker: videoChunker() });
          const chunkSize = 1024 * 1024;
          const file = video.videoFile;

          for (let offset = 0; offset < file.size; offset += chunkSize) {
            if (abortController.signal.aborted) throw new Error('Cancelled');

            const chunk = file.slice(offset, Math.min(offset + chunkSize, file.size));
            const data = new Uint8Array(await chunk.arrayBuffer());
            await streamWriter.append(data);

            // Update progress within this video
            const fileProgress = offset / file.size;
            const overallProgress = ((i + fileProgress * 0.8) / selectedVideos.length) * 100;
            progress = Math.round(overallProgress);
          }

          const result = await streamWriter.finalize();
          const ext = file.name.split('.').pop()?.toLowerCase() || 'mp4';
          videoEntries.push({
            name: `video.${ext}`,
            cid: cid(result.hash, result.key),
            size: result.size,
          });
        }

        // Upload info.json and extract description
        if (video.infoJson) {
          const data = new Uint8Array(await video.infoJson.arrayBuffer());
          const result = await tree.putFile(data, { public: isPublic });
          videoEntries.push({ name: 'info.json', cid: result.cid, size: result.size });

          // Extract description from info.json and save as description.txt
          try {
            const jsonText = await video.infoJson.text();
            const infoData = JSON.parse(jsonText);
            if (infoData.description && infoData.description.trim()) {
              const descData = new TextEncoder().encode(infoData.description.trim());
              const descResult = await tree.putFile(descData, { public: isPublic });
              videoEntries.push({ name: 'description.txt', cid: descResult.cid, size: descResult.size });
            }
            // Also extract title.txt from info.json if available
            if (infoData.title && infoData.title.trim()) {
              const titleData = new TextEncoder().encode(infoData.title.trim());
              const titleResult = await tree.putFile(titleData, { public: isPublic });
              videoEntries.push({ name: 'title.txt', cid: titleResult.cid, size: titleResult.size });
            }
          } catch {
            // Ignore JSON parse errors
          }
        }

        // Upload thumbnail
        if (video.thumbnail) {
          const data = new Uint8Array(await video.thumbnail.arrayBuffer());
          const result = await tree.putFile(data, { public: isPublic });
          const ext = video.thumbnail.name.split('.').pop()?.toLowerCase() || 'jpg';
          videoEntries.push({ name: `thumbnail.${ext}`, cid: result.cid, size: result.size });
        }

        // Create video directory
        const videoDirResult = await tree.putDirectory(videoEntries, { public: isPublic });

        // Add to root entries using video ID as folder name
        rootEntries.push({
          name: video.id,
          cid: videoDirResult.cid,
          size: videoEntries.reduce((sum, e) => sum + (e.size || 0), 0),
        });
      }

      progress = 95;
      progressMessage = 'Creating channel...';

      // Create root directory with all video subdirectories
      const rootDirResult = await tree.putDirectory(rootEntries, { public: isPublic });

      // Publish to Nostr
      progressMessage = 'Publishing...';
      const rootHash = toHex(rootDirResult.cid.hash);
      const rootKey = rootDirResult.cid.key ? toHex(rootDirResult.cid.key) : undefined;

      const result = await saveHashtree(treeName, rootHash, rootKey, { visibility });
      progress = 100;

      // Store link key for unlisted
      if (result.linkKey && userNpub) {
        storeLinkKey(userNpub, treeName, result.linkKey);
      }

      // Don't add playlists to recents - only individual videos get added when watched
      // Users can find their playlists on their profile page

      // Navigate to the channel
      uploading = false;
      progressMessage = '';
      const encodedTreeName = encodeURIComponent(treeName);
      const url = result.linkKey ? `#/${userNpub}/${encodedTreeName}?k=${result.linkKey}` : `#/${userNpub}/${encodedTreeName}`;
      window.location.hash = url;
      handleClose();
    } catch (e) {
      console.error('Batch upload failed:', e);
      const message = e instanceof Error ? e.message : 'Unknown error';
      if (message !== 'Cancelled') {
        alert('Failed to upload videos: ' + message);
      }
      uploading = false;
      progressMessage = '';
      abortController = null;
    }
  }

  function handleCancelUpload() {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    uploading = false;
    progressMessage = '';
  }

  // ========== Stream Tab Functions ==========
  async function handleStartCamera() {
    try {
      await startPreview(videoRef ?? null);
    } catch (e) {
      console.error('Failed to start camera:', e);
      alert('Failed to access camera. Please check permissions.');
    }
  }

  function handleStopCamera() {
    stopPreview(videoRef ?? null);
  }

  async function handleStartRecording() {
    if (!streamTitle.trim()) {
      alert('Please enter a title first');
      return;
    }
    const isPublic = streamVisibility === 'public';
    await startRecording(videoRef ?? null, isPublic);

    // Generate thumbnail from first frame
    if (videoRef) {
      setTimeout(() => {
        generateStreamThumbnail();
      }, 500);
    }
  }

  function generateStreamThumbnail() {
    if (!videoRef) return;

    try {
      const canvas = document.createElement('canvas');
      const maxWidth = 640;
      const maxHeight = 360;

      const videoAspect = videoRef.videoWidth / videoRef.videoHeight;
      let width = videoRef.videoWidth;
      let height = videoRef.videoHeight;

      if (width > maxWidth) {
        width = maxWidth;
        height = width / videoAspect;
      }
      if (height > maxHeight) {
        height = maxHeight;
        width = height * videoAspect;
      }

      canvas.width = Math.round(width);
      canvas.height = Math.round(height);

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(videoRef, 0, 0, canvas.width, canvas.height);

        canvas.toBlob((blob) => {
          if (blob) {
            streamThumbnailBlob = blob;
            if (streamThumbnailUrl) URL.revokeObjectURL(streamThumbnailUrl);
            streamThumbnailUrl = URL.createObjectURL(blob);
          }
        }, 'image/jpeg', 0.8);
      }
    } catch (e) {
      console.error('Failed to generate stream thumbnail:', e);
    }
  }

  async function handleStopRecording() {
    saving = true;
    try {
      const result = await stopRecording(
        streamTitle.trim(),
        streamDescription.trim(),
        streamVisibility,
        streamThumbnailBlob
      );

      if (result.success && result.videoUrl) {
        window.location.hash = result.videoUrl;
        handleClose();
      } else {
        alert('Failed to save recording');
      }
    } catch (e) {
      console.error('Failed to stop recording:', e);
      alert('Failed to save recording');
    } finally {
      saving = false;
    }
  }

  function handleCancelRecording() {
    cancelRecording();
    if (videoRef) {
      videoRef.srcObject = null;
    }
  }

  // ========== Modal Functions ==========
  function handleClose() {
    if (uploading) {
      handleCancelUpload();
    }
    if (streamState.isRecording || streamState.isPreviewing) {
      cancelRecording();
      if (videoRef) {
        videoRef.srcObject = null;
      }
    }

    // Reset all state
    mode = 'select';
    selectedFile = null;
    title = '';
    description = '';
    progress = 0;
    progressMessage = '';
    willTranscode = false;
    visibility = 'public';
    abortController = null;
    batchVideos = [];
    selectedVideoIds.clear();
    channelName = '';
    batchCurrentIndex = 0;
    batchTotalSize = 0;
    if (thumbnailUrl) {
      URL.revokeObjectURL(thumbnailUrl);
      thumbnailUrl = null;
    }
    thumbnailBlob = null;

    // Reset stream tab state
    streamTitle = '';
    streamDescription = '';
    streamVisibility = 'public';
    if (streamThumbnailUrl) {
      URL.revokeObjectURL(streamThumbnailUrl);
      streamThumbnailUrl = null;
    }
    streamThumbnailBlob = null;

    closeVideoUploadModal();
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget && !isBusy) {
      handleClose();
    }
  }

  function handleBack() {
    mode = 'select';
    selectedFile = null;
    title = '';
    description = '';
    batchVideos = [];
    selectedVideoIds.clear();
    channelName = '';
    if (thumbnailUrl) {
      URL.revokeObjectURL(thumbnailUrl);
      thumbnailUrl = null;
    }
    thumbnailBlob = null;
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
</script>

{#if showModal}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
    onclick={handleBackdropClick}
  >
    <div class="bg-surface-1 rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-auto">
      <!-- Header with tabs -->
      <div class="flex items-center justify-between p-4 border-b border-surface-3">
        <div class="flex items-center gap-2">
          {#if activeTab === 'upload' && mode !== 'select' && !uploading}
            <button onclick={handleBack} class="btn-ghost p-1">
              <span class="i-lucide-arrow-left text-lg"></span>
            </button>
          {/if}
          <div class="flex items-center gap-4">
            <button
              onclick={() => handleTabChange('upload')}
              class="text-lg font-semibold transition-colors {activeTab === 'upload' ? 'text-text-1' : 'text-text-3 hover:text-text-2'}"
              disabled={isBusy}
            >
              {#if activeTab === 'upload' && mode === 'batch'}
                Upload {batchVideos.length} Videos
              {:else}
                Upload
              {/if}
            </button>
            <button
              onclick={() => handleTabChange('stream')}
              class="text-lg font-semibold transition-colors {activeTab === 'stream' ? 'text-text-1' : 'text-text-3 hover:text-text-2'}"
              disabled={isBusy}
            >
              Record
            </button>
          </div>
        </div>
        <button onclick={handleClose} class="btn-ghost p-1" disabled={isBusy}>
          <span class="i-lucide-x text-xl"></span>
        </button>
      </div>

      <!-- Upload Tab Content -->
      {#if activeTab === 'upload'}
        <div class="p-4 space-y-4">
          {#if mode === 'select'}
            <!-- Selection mode: file or folder -->
            <div
              class="aspect-video bg-surface-2 rounded-lg overflow-hidden flex items-center justify-center cursor-pointer hover:bg-surface-3 transition-colors border-2 border-dashed {isDragging ? 'border-accent bg-accent/10' : 'border-surface-3'}"
              onclick={() => fileInput?.click()}
              ondragover={handleDragOver}
              ondragleave={handleDragLeave}
              ondrop={handleDrop}
            >
              <div class="text-center p-4">
                <span class="i-lucide-upload text-4xl text-accent mb-2 block"></span>
                <p class="text-text-2">Click to select a video file</p>
                <p class="text-text-3 text-sm mt-1">or drag & drop files/folders here</p>
                <button
                  type="button"
                  class="btn-ghost text-accent text-sm mt-3"
                  onclick={(e) => { e.stopPropagation(); folderInput?.click(); }}
                >
                  <span class="i-lucide-folder-open mr-1"></span>
                  Select folder
                </button>
              </div>
            </div>
            <input
              bind:this={fileInput}
              type="file"
              accept="video/*"
              class="hidden"
              onchange={handleFileSelect}
            />
            <input
              bind:this={folderInput}
              type="file"
              webkitdirectory
              class="hidden"
              onchange={handleFolderSelect}
            />

          {:else if mode === 'single'}
            <!-- Single video mode -->
            <div
              class="aspect-video bg-surface-2 rounded-lg overflow-hidden flex items-center justify-center cursor-pointer hover:bg-surface-3 transition-colors {uploading ? 'pointer-events-none' : ''}"
              onclick={() => !uploading && fileInput?.click()}
            >
              {#if thumbnailUrl}
                <img src={thumbnailUrl} alt="Thumbnail" class="w-full h-full object-cover" />
              {:else}
                <div class="text-center">
                  <span class="i-lucide-video text-4xl text-text-3 mb-2 block"></span>
                  <p class="text-text-3">Generating thumbnail...</p>
                </div>
              {/if}
            </div>

            <!-- File info -->
            {#if selectedFile}
              <div class="text-sm text-text-3 flex flex-col gap-1">
                <span>{selectedFile.name} ({formatSize(selectedFile.size)})</span>
                {#if willTranscode}
                  {#if transcodeSupported && !transcodeError}
                    <span class="text-xs bg-accent/20 text-accent px-2 py-0.5 rounded w-fit">Will convert to WebM</span>
                  {:else}
                    <span class="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded w-fit">
                      {transcodeError || 'Cannot convert: SharedArrayBuffer not available. Use Chrome/Edge or upload MP4/WebM.'}
                    </span>
                  {/if}
                {/if}
              </div>
            {/if}

            <!-- Title -->
            <div>
              <label class="block text-sm text-text-2 mb-1">Title</label>
              <input
                type="text"
                bind:value={title}
                class="w-full bg-surface-0 border border-surface-3 rounded-lg p-3 text-text-1 focus:border-accent focus:outline-none"
                placeholder="Video title"
                disabled={uploading}
              />
            </div>

            <!-- Description -->
            <div>
              <label class="block text-sm text-text-2 mb-1">Description (optional)</label>
              <textarea
                bind:value={description}
                class="w-full bg-surface-0 border border-surface-3 rounded-lg p-3 text-text-1 resize-none focus:border-accent focus:outline-none"
                placeholder="Video description..."
                rows="2"
                disabled={uploading}
              ></textarea>
            </div>

          {:else if mode === 'batch'}
            <!-- Batch mode: yt-dlp directory -->
            <div class="bg-surface-2 rounded-lg p-4">
              <div class="flex items-center gap-3 mb-3">
                <span class="i-lucide-folder-video text-2xl text-accent"></span>
                <div>
                  <p class="text-text-1 font-medium">yt-dlp Backup Detected</p>
                  <p class="text-text-3 text-sm">{batchVideos.length} videos, {formatSize(batchTotalSize)} total</p>
                </div>
              </div>

              <!-- Channel name input -->
              <div class="mb-3">
                <label class="block text-sm text-text-2 mb-1">Channel Name</label>
                <input
                  type="text"
                  bind:value={channelName}
                  class="w-full bg-surface-0 border border-surface-3 rounded-lg p-2 text-text-1 focus:border-accent focus:outline-none"
                  placeholder="Channel name"
                  disabled={uploading}
                />
              </div>

              <BatchVideoList
                videos={batchVideos}
                selectedIds={selectedVideoIds}
                currentUploadingId={uploading ? selectedVideos[batchCurrentIndex]?.id : null}
                disabled={uploading}
                onToggle={toggleVideo}
                onSelectAll={selectAll}
                onDeselectAll={deselectAll}
                {formatSize}
              />
            </div>
          {/if}

          <!-- Visibility (shown for single and batch) -->
          {#if mode !== 'select'}
            <VisibilitySelector
              value={visibility}
              onchange={(v) => visibility = v}
              disabled={uploading}
              mode={mode}
            />
          {/if}

          <!-- Progress bar -->
          {#if uploading}
            <UploadProgress {progress} message={progressMessage} />
          {/if}
        </div>

        <!-- Upload Footer -->
        <div class="flex justify-end gap-2 p-4 border-t border-surface-3">
          <button onclick={uploading ? handleCancelUpload : handleClose} class="btn-ghost px-4 py-2">
            {uploading ? 'Cancel' : 'Close'}
          </button>
          {#if mode !== 'select'}
            <button
              onclick={handleUpload}
              class="btn-primary px-4 py-2"
              disabled={
                uploading ||
                (mode === 'single' && (!selectedFile || !title.trim() || (willTranscode && (!transcodeSupported || !!transcodeError)))) ||
                (mode === 'batch' && (!channelName.trim() || selectedVideos.length === 0))
              }
            >
              {#if uploading}
                Processing...
              {:else if mode === 'batch'}
                Upload {selectedVideos.length} Video{selectedVideos.length !== 1 ? 's' : ''}
              {:else}
                Upload
              {/if}
            </button>
          {/if}
        </div>
      {/if}

      <!-- Stream Tab Content -->
      {#if activeTab === 'stream'}
        <div class="p-4 space-y-4">
          <!-- Video preview -->
          <div class="aspect-video bg-surface-2 rounded-lg overflow-hidden flex items-center justify-center">
            <!-- svelte-ignore a11y_media_has_caption -->
            <video
              bind:this={videoRef}
              autoplay
              muted
              playsinline
              class="w-full h-full object-cover {streamState.isPreviewing || streamState.isRecording ? '' : 'hidden'}"
            ></video>
            {#if !streamState.isPreviewing && !streamState.isRecording}
              <div class="text-center">
                <span class="i-lucide-video text-4xl text-accent mb-2 block"></span>
                <p class="text-text-2">Record a video from your camera</p>
              </div>
            {/if}
          </div>

          <!-- Recording status -->
          {#if streamState.isRecording}
            <div class="flex items-center justify-between text-sm">
              <div class="flex items-center gap-2 text-danger">
                <span class="w-2 h-2 bg-danger rounded-full animate-pulse"></span>
                <span>REC {formatTime(streamState.recordingTime)}</span>
              </div>
              <span class="text-text-3">{formatBytes(streamState.streamStats.totalSize)}</span>
            </div>
          {/if}

          <!-- Title (required before recording) -->
          <div>
            <label class="block text-sm text-text-2 mb-1">Title</label>
            <input
              type="text"
              bind:value={streamTitle}
              class="w-full bg-surface-0 border border-surface-3 rounded-lg p-3 text-text-1 focus:border-accent focus:outline-none"
              placeholder="Video title"
              disabled={streamState.isRecording || saving}
            />
          </div>

          <!-- Description -->
          <div>
            <label class="block text-sm text-text-2 mb-1">Description (optional)</label>
            <textarea
              bind:value={streamDescription}
              class="w-full bg-surface-0 border border-surface-3 rounded-lg p-3 text-text-1 resize-none focus:border-accent focus:outline-none"
              placeholder="Video description..."
              rows="2"
              disabled={streamState.isRecording || saving}
            ></textarea>
          </div>

          <!-- Visibility -->
          <div>
            <label class="block text-sm text-text-2 mb-2">Visibility</label>
            <div class="flex gap-2">
              <button
                type="button"
                onclick={() => streamVisibility = 'public'}
                class="flex-1 flex items-center justify-center gap-2 py-2 px-3 btn-ghost {streamVisibility === 'public' ? 'ring-2 ring-accent bg-surface-3' : ''}"
                disabled={streamState.isRecording || saving}
              >
                <span class="i-lucide-globe"></span>
                <span class="text-sm">Public</span>
              </button>
              <button
                type="button"
                onclick={() => streamVisibility = 'unlisted'}
                class="flex-1 flex items-center justify-center gap-2 py-2 px-3 btn-ghost {streamVisibility === 'unlisted' ? 'ring-2 ring-accent bg-surface-3' : ''}"
                disabled={streamState.isRecording || saving}
              >
                <span class="i-lucide-link"></span>
                <span class="text-sm">Unlisted</span>
              </button>
              <button
                type="button"
                onclick={() => streamVisibility = 'private'}
                class="flex-1 flex items-center justify-center gap-2 py-2 px-3 btn-ghost {streamVisibility === 'private' ? 'ring-2 ring-accent bg-surface-3' : ''}"
                disabled={streamState.isRecording || saving}
              >
                <span class="i-lucide-lock"></span>
                <span class="text-sm">Private</span>
              </button>
            </div>
            <p class="text-xs text-text-3 mt-2">
              {#if streamVisibility === 'public'}
                Anyone can find and watch this video
              {:else if streamVisibility === 'unlisted'}
                Only people with the link can watch
              {:else}
                Encrypted, only you can watch
              {/if}
            </p>
          </div>
        </div>

        <!-- Stream Footer -->
        <div class="flex justify-end gap-2 p-4 border-t border-surface-3">
          {#if !streamState.isPreviewing && !streamState.isRecording}
            <button onclick={handleClose} class="btn-ghost px-4 py-2">
              Close
            </button>
            <button onclick={handleStartCamera} class="btn-primary px-4 py-2">
              <span class="i-lucide-video mr-2"></span>
              Start Camera
            </button>
          {:else if streamState.isPreviewing && !streamState.isRecording}
            <button onclick={handleStopCamera} class="btn-ghost px-4 py-2">
              Cancel
            </button>
            <button
              onclick={handleStartRecording}
              class="btn-danger px-4 py-2"
              disabled={!streamTitle.trim()}
            >
              <span class="i-lucide-circle mr-2"></span>
              Start Recording
            </button>
          {:else if streamState.isRecording}
            <button onclick={handleCancelRecording} class="btn-ghost px-4 py-2" disabled={saving}>
              Cancel
            </button>
            <button onclick={handleStopRecording} class="btn-success px-4 py-2" disabled={saving}>
              {#if saving}
                <span class="i-lucide-loader-2 animate-spin mr-2"></span>
                Saving...
              {:else}
                <span class="i-lucide-square mr-2"></span>
                Stop Recording
              {/if}
            </button>
          {/if}
        </div>
      {/if}
    </div>
  </div>
{/if}
