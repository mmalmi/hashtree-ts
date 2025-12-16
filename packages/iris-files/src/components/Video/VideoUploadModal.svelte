<script lang="ts">
  /**
   * VideoUploadModal - Upload video files with metadata
   * Transcodes non-webm/mp4 files to WebM using FFmpeg WASM (lazy-loaded)
   */
  import { onMount } from 'svelte';
  import { modalsStore, closeVideoUploadModal } from '../../stores/modals';
  import { nostrStore, saveHashtree } from '../../nostr';
  import { toHex } from 'hashtree';
  import { getTree } from '../../store';
  import { addRecent } from '../../stores/recents';
  import { storeLinkKey } from '../../stores/trees';
  import { needsTranscoding, transcodeToWebM, type TranscodeProgress } from '../../utils/videoTranscode';

  let showModal = $derived($modalsStore.showVideoUploadModal);

  // Handle escape key to close modal
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && showModal && !uploading) {
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

  let fileInput: HTMLInputElement | undefined = $state();
  let selectedFile = $state<File | null>(null);
  let title = $state('');
  let description = $state('');
  let uploading = $state(false);
  let progress = $state(0);
  let progressMessage = $state('');
  let thumbnailUrl = $state<string | null>(null);
  let thumbnailBlob = $state<Blob | null>(null);
  let willTranscode = $state(false);
  let visibility = $state<'public' | 'unlisted' | 'private'>('public');

  function handleFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    selectedFile = file;
    willTranscode = needsTranscoding(file);

    // Default title from filename (without extension)
    if (!title) {
      title = file.name.replace(/\.[^/.]+$/, '');
    }

    // Generate thumbnail from video
    generateThumbnail(file);
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

      // Draw to canvas - maintain video aspect ratio
      const canvas = document.createElement('canvas');
      const maxWidth = 640;
      const maxHeight = 360;

      // Calculate dimensions maintaining aspect ratio
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
    if (!selectedFile || !title.trim() || !userNpub) return;

    uploading = true;
    progress = 0;
    progressMessage = 'Preparing...';

    try {
      const tree = getTree();
      const treeName = `videos/${title.trim()}`;

      let videoData: Uint8Array;
      let videoFileName: string;
      let mimeType: string;

      // Check if transcoding is needed
      if (willTranscode) {
        progressMessage = 'Loading encoder...';
        progress = 5;

        const result = await transcodeToWebM(selectedFile, (p: TranscodeProgress) => {
          progressMessage = p.message;
          if (p.percent !== undefined) {
            // Transcoding is 5-50% of total progress
            progress = 5 + Math.round(p.percent * 0.45);
          }
        });

        videoData = result.data;
        videoFileName = `video.${result.extension}`;
        mimeType = result.mimeType;
        progress = 50;
      } else {
        progressMessage = 'Reading file...';
        progress = 10;
        videoData = new Uint8Array(await selectedFile.arrayBuffer());
        const ext = selectedFile.name.split('.').pop()?.toLowerCase() || 'webm';
        videoFileName = `video.${ext}`;
        mimeType = selectedFile.type || `video/${ext}`;
        progress = 50;
      }

      progressMessage = 'Uploading video...';
      progress = 55;

      // Public: content is unencrypted (anyone with hash can read)
      // Unlisted/Private: content is encrypted (key needed to read)
      // The difference between unlisted and private is how the key is shared in Nostr:
      // - Unlisted: key is encrypted with a link key (shareable link)
      // - Private: key is encrypted to self only
      const isPublic = visibility === 'public';

      // Upload video file
      const videoResult = await tree.putFile(videoData, { public: isPublic });
      progress = 75;

      // Prepare directory entries
      const entries: Array<{ name: string; cid: any; size?: number }> = [
        { name: videoFileName, cid: videoResult.cid, size: videoResult.size },
      ];

      // Upload title.txt
      progressMessage = 'Saving metadata...';
      const titleData = new TextEncoder().encode(title.trim());
      const titleResult = await tree.putFile(titleData, { public: isPublic });
      entries.push({ name: 'title.txt', cid: titleResult.cid, size: titleResult.size });

      // Upload description.txt if provided
      if (description.trim()) {
        const descData = new TextEncoder().encode(description.trim());
        const descResult = await tree.putFile(descData, { public: isPublic });
        entries.push({ name: 'description.txt', cid: descResult.cid, size: descResult.size });
      }
      progress = 80;

      // Upload thumbnail if available
      if (thumbnailBlob) {
        const thumbData = new Uint8Array(await thumbnailBlob.arrayBuffer());
        const thumbResult = await tree.putFile(thumbData, { public: isPublic });
        entries.push({ name: 'thumbnail.jpg', cid: thumbResult.cid, size: thumbResult.size });
      }
      progress = 85;

      // Create directory
      progressMessage = 'Creating video...';
      const dirResult = await tree.putDirectory(entries, { public: isPublic });
      progress = 90;

      // Publish to Nostr with proper visibility handling
      progressMessage = 'Publishing...';
      const rootHash = toHex(dirResult.cid.hash);
      const rootKey = dirResult.cid.key ? toHex(dirResult.cid.key) : undefined;

      const result = await saveHashtree(treeName, rootHash, rootKey, { visibility });
      progress = 100;

      // Store link key for unlisted videos
      if (result.linkKey && userNpub) {
        storeLinkKey(userNpub, treeName, result.linkKey);
      }

      // Add to recents
      addRecent({
        type: 'tree',
        path: `/${userNpub}/${treeName}`,
        label: title.trim(),
        npub: userNpub,
        treeName,
        visibility,
        linkKey: result.linkKey,
      });

      // Navigate to the video and close modal
      uploading = false;
      progressMessage = '';
      const videoUrl = result.linkKey ? `#/${userNpub}/${treeName}?k=${result.linkKey}` : `#/${userNpub}/${treeName}`;
      window.location.hash = videoUrl;
      handleClose();
    } catch (e) {
      console.error('Upload failed:', e);
      alert('Failed to upload video: ' + (e instanceof Error ? e.message : 'Unknown error'));
      uploading = false;
      progressMessage = '';
    }
  }

  function handleClose() {
    if (uploading) return;
    selectedFile = null;
    title = '';
    description = '';
    progress = 0;
    progressMessage = '';
    willTranscode = false;
    visibility = 'public';
    if (thumbnailUrl) {
      URL.revokeObjectURL(thumbnailUrl);
      thumbnailUrl = null;
    }
    thumbnailBlob = null;
    closeVideoUploadModal();
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      handleClose();
    }
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
      <!-- Header -->
      <div class="flex items-center justify-between p-4 border-b border-surface-3">
        <h2 class="text-lg font-semibold text-text-1">Upload Video</h2>
        <button onclick={handleClose} class="btn-ghost p-1" disabled={uploading}>
          <span class="i-lucide-x text-xl"></span>
        </button>
      </div>

      <!-- Content -->
      <div class="p-4 space-y-4">
        {#if !selectedFile}
          <!-- File selection -->
          <div
            class="border-2 border-dashed border-surface-3 rounded-lg p-8 text-center hover:border-accent transition-colors cursor-pointer"
            onclick={() => fileInput?.click()}
          >
            <span class="i-lucide-upload text-4xl text-accent mb-2 block"></span>
            <p class="text-text-2">Click to select a video file</p>
            <p class="text-text-3 text-sm mt-1">MP4, WebM, MOV, AVI, MKV supported</p>
          </div>
          <input
            bind:this={fileInput}
            type="file"
            accept="video/*"
            class="hidden"
            onchange={handleFileSelect}
          />
        {:else}
          <!-- Preview and metadata -->
          <div class="space-y-4">
            <!-- Thumbnail preview -->
            <div class="aspect-video bg-surface-2 rounded-lg overflow-hidden flex items-center justify-center">
              {#if thumbnailUrl}
                <img src={thumbnailUrl} alt="Thumbnail" class="w-full h-full object-cover" />
              {:else}
                <span class="i-lucide-video text-4xl text-text-3"></span>
              {/if}
            </div>

            <!-- File info -->
            <div class="text-sm text-text-3 flex items-center gap-2">
              <span>{selectedFile.name} ({formatSize(selectedFile.size)})</span>
              {#if willTranscode}
                <span class="text-xs bg-accent/20 text-accent px-2 py-0.5 rounded">Will convert to WebM</span>
              {/if}
            </div>

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
                rows="3"
                disabled={uploading}
              ></textarea>
            </div>

            <!-- Visibility -->
            <div>
              <label class="block text-sm text-text-2 mb-2">Visibility</label>
              <div class="flex gap-2">
                <button
                  type="button"
                  onclick={() => visibility = 'public'}
                  class="flex-1 flex items-center justify-center gap-2 py-2 px-3 btn-ghost {visibility === 'public' ? 'ring-2 ring-accent bg-surface-3' : ''}"
                  disabled={uploading}
                >
                  <span class="i-lucide-globe"></span>
                  <span class="text-sm">Public</span>
                </button>
                <button
                  type="button"
                  onclick={() => visibility = 'unlisted'}
                  class="flex-1 flex items-center justify-center gap-2 py-2 px-3 btn-ghost {visibility === 'unlisted' ? 'ring-2 ring-accent bg-surface-3' : ''}"
                  disabled={uploading}
                >
                  <span class="i-lucide-link"></span>
                  <span class="text-sm">Unlisted</span>
                </button>
                <button
                  type="button"
                  onclick={() => visibility = 'private'}
                  class="flex-1 flex items-center justify-center gap-2 py-2 px-3 btn-ghost {visibility === 'private' ? 'ring-2 ring-accent bg-surface-3' : ''}"
                  disabled={uploading}
                >
                  <span class="i-lucide-lock"></span>
                  <span class="text-sm">Private</span>
                </button>
              </div>
              <p class="text-xs text-text-3 mt-2">
                {#if visibility === 'public'}
                  Anyone can find and watch this video
                {:else if visibility === 'unlisted'}
                  Only people with the link can watch
                {:else}
                  Encrypted, only you can watch
                {/if}
              </p>
            </div>

            <!-- Progress bar -->
            {#if uploading}
              <div class="space-y-2">
                <div class="flex justify-between text-sm text-text-3">
                  <span>{progressMessage || 'Processing...'}</span>
                  <span>{progress}%</span>
                </div>
                <div class="h-2 bg-surface-2 rounded-full overflow-hidden">
                  <div
                    class="h-full bg-accent transition-all duration-300"
                    style="width: {progress}%"
                  ></div>
                </div>
              </div>
            {/if}
          </div>
        {/if}
      </div>

      <!-- Footer -->
      <div class="flex justify-end gap-2 p-4 border-t border-surface-3">
        <button onclick={handleClose} class="btn-ghost px-4 py-2" disabled={uploading}>
          Cancel
        </button>
        {#if selectedFile}
          <button
            onclick={handleUpload}
            class="btn-primary px-4 py-2"
            disabled={!title.trim() || uploading}
          >
            {uploading ? 'Processing...' : 'Upload'}
          </button>
        {/if}
      </div>
    </div>
  </div>
{/if}
