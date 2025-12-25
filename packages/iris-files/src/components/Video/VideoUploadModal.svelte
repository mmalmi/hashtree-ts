<script lang="ts" module>
  /**
   * VideoUploadModal - Simple modal for uploading a single video
   */
  let show = $state(false);

  export function open() {
    show = true;
  }

  export function close() {
    show = false;
  }
</script>

<script lang="ts">
  import { nostrStore, saveHashtree } from '../../nostr';
  import { toHex, videoChunker, type CID } from 'hashtree';
  import { getTree } from '../../store';
  import { addRecent } from '../../stores/recents';
  import { storeLinkKey } from '../../stores/trees';
  import { needsTranscoding, transcodeToMP4Streaming, isTranscodingSupported, canTranscode, type TranscodeProgress } from '../../utils/videoTranscode';

  let userNpub = $derived($nostrStore.npub);

  // State
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
  let transcodeSupported = $state(true);
  let transcodeError = $state<string | null>(null);
  let visibility = $state<'public' | 'unlisted' | 'private'>('public');
  let abortController = $state<AbortController | null>(null);

  // Reset state when modal closes
  $effect(() => {
    if (!show) {
      selectedFile = null;
      title = '';
      description = '';
      progress = 0;
      progressMessage = '';
      willTranscode = false;
      visibility = 'public';
      abortController = null;
      if (thumbnailUrl) {
        URL.revokeObjectURL(thumbnailUrl);
        thumbnailUrl = null;
      }
      thumbnailBlob = null;
    }
  });

  function handleFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

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

  function generateThumbnail(file: File) {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    const url = URL.createObjectURL(file);
    video.src = url;

    video.onloadeddata = () => {
      video.currentTime = Math.min(1, video.duration * 0.1);
    };

    video.onseeked = () => {
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

      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, width, height);
        canvas.toBlob((blob) => {
          if (blob) {
            if (thumbnailUrl) URL.revokeObjectURL(thumbnailUrl);
            thumbnailUrl = URL.createObjectURL(blob);
            thumbnailBlob = blob;
          }
        }, 'image/jpeg', 0.85);
      }

      URL.revokeObjectURL(url);
    };

    video.onerror = () => {
      URL.revokeObjectURL(url);
    };
  }

  async function handleUpload() {
    if (!selectedFile || !title.trim() || !userNpub) return;

    uploading = true;
    progress = 0;
    progressMessage = 'Preparing...';
    abortController = new AbortController();

    try {
      const tree = getTree();
      const treeName = `videos/${title.trim().replace(/[<>:"/\\|?*]/g, '_')}`;
      const isPublic = visibility === 'public';

      let videoResult: { cid: CID; size: number };
      let videoFileName: string;

      if (willTranscode && !transcodeError) {
        progressMessage = 'Transcoding...';
        const streamWriter = tree.createStream({ chunker: videoChunker() });

        await transcodeToMP4Streaming(
          selectedFile,
          async (chunk: Uint8Array) => {
            await streamWriter.append(chunk);
          },
          (p: TranscodeProgress) => {
            progress = Math.round(p.percent * 0.6);
            progressMessage = `Transcoding: ${p.percent.toFixed(0)}%`;
          }
        );

        const finalResult = await streamWriter.finalize();
        videoResult = {
          cid: { hash: finalResult.hash, key: finalResult.key },
          size: finalResult.size
        };
        videoFileName = 'video.webm';
        progress = 65;
      } else {
        progressMessage = 'Uploading...';
        const streamWriter = tree.createStream({ chunker: videoChunker() });
        const chunkSize = 1024 * 1024;

        for (let offset = 0; offset < selectedFile.size; offset += chunkSize) {
          if (abortController.signal.aborted) throw new Error('Cancelled');

          const chunk = selectedFile.slice(offset, Math.min(offset + chunkSize, selectedFile.size));
          const data = new Uint8Array(await chunk.arrayBuffer());
          await streamWriter.append(data);

          progress = Math.round((offset / selectedFile.size) * 60);
          progressMessage = `Uploading: ${Math.round((offset / selectedFile.size) * 100)}%`;
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

      const entries: Array<{ name: string; cid: CID; size?: number }> = [
        { name: videoFileName, cid: videoResult.cid, size: videoResult.size },
      ];

      const titleData = new TextEncoder().encode(title.trim());
      const titleResult = await tree.putFile(titleData, {});
      entries.push({ name: 'title.txt', cid: titleResult.cid, size: titleResult.size });

      if (description.trim()) {
        const descData = new TextEncoder().encode(description.trim());
        const descResult = await tree.putFile(descData, {});
        entries.push({ name: 'description.txt', cid: descResult.cid, size: descResult.size });
      }
      progress = 80;

      if (thumbnailBlob) {
        const thumbData = new Uint8Array(await thumbnailBlob.arrayBuffer());
        const thumbResult = await tree.putFile(thumbData, {});
        entries.push({ name: 'thumbnail.jpg', cid: thumbResult.cid, size: thumbResult.size });
      }
      progress = 85;

      progressMessage = 'Creating video...';
      const dirResult = await tree.putDirectory(entries, {});
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
      close();
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

  function handleCancel() {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    uploading = false;
    progressMessage = '';
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
</script>

{#if show}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onclick={() => !uploading && close()}>
    <div class="bg-surface-1 rounded-lg shadow-lg w-full max-w-lg mx-4 max-h-[90vh] overflow-auto" onclick={(e) => e.stopPropagation()}>
      <!-- Header -->
      <div class="p-4 border-b border-surface-3 flex items-center justify-between">
        <h2 class="text-lg font-semibold flex items-center gap-2">
          <span class="i-lucide-upload text-accent"></span>
          Upload Video
        </h2>
        <button onclick={() => !uploading && close()} class="btn-ghost p-1" disabled={uploading} title="Close">
          <span class="i-lucide-x text-lg"></span>
        </button>
      </div>

      <!-- Content -->
      <div class="p-4 space-y-4">
        <!-- File selection / preview area -->
        <div
          class="aspect-video bg-surface-2 rounded-lg overflow-hidden flex items-center justify-center cursor-pointer hover:bg-surface-3 transition-colors {uploading ? 'pointer-events-none' : ''}"
          onclick={() => !uploading && fileInput?.click()}
        >
          {#if thumbnailUrl}
            <img src={thumbnailUrl} alt="Thumbnail" class="w-full h-full object-cover" />
          {:else}
            <div class="text-center p-4">
              <span class="i-lucide-upload text-4xl text-accent mb-2 block mx-auto"></span>
              <p class="text-text-2">Click to select a video file</p>
              <p class="text-text-3 text-sm mt-1">MP4, WebM, MOV, AVI, MKV supported</p>
            </div>
          {/if}
        </div>
        <input
          bind:this={fileInput}
          type="file"
          accept="video/*"
          class="hidden"
          onchange={handleFileSelect}
        />

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

      <!-- Footer -->
      <div class="p-4 border-t border-surface-3 flex justify-end gap-2">
        <button onclick={uploading ? handleCancel : close} class="btn-ghost px-4 py-2">
          {uploading ? 'Cancel' : 'Close'}
        </button>
        <button
          onclick={handleUpload}
          class="btn-primary px-4 py-2"
          disabled={!selectedFile || !title.trim() || uploading || (willTranscode && (!transcodeSupported || !!transcodeError))}
        >
          {uploading ? 'Processing...' : 'Upload'}
        </button>
      </div>
    </div>
  </div>
{/if}
