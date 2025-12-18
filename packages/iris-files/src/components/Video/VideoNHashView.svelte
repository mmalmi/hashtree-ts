<script lang="ts">
  /**
   * VideoNHashView - Video player for content-addressed permalinks
   * Displays video from an nhash pointing directly to the video file blob
   */
  import { untrack } from 'svelte';
  import { nhashDecode, type CID } from 'hashtree';
  import { openShareModal } from '../../stores/modals';
  import { getNhashFileUrl } from '../../lib/mediaUrl';
  import VideoComments from './VideoComments.svelte';

  interface Props {
    nhash: string;
  }

  let { nhash }: Props = $props();

  let videoSrc = $state<string>('');
  let loading = $state(true);
  let error = $state<string | null>(null);
  let videoCid = $state<CID | null>(null);
  let videoRef: HTMLVideoElement | undefined = $state();

  // Decode nhash to CID - nhashDecode returns CID with Uint8Array fields directly
  let decodedCid = $derived.by(() => {
    try {
      const result = nhashDecode(nhash);
      console.log('[VideoNHashView] Decoded nhash:', nhash, result);
      return result;
    } catch (e) {
      console.error('[VideoNHashView] Failed to decode nhash:', nhash, e);
      return null;
    }
  });

  // Load video when nhash changes
  $effect(() => {
    const cid = decodedCid;
    console.log('[VideoNHashView] Effect running, cid:', cid);
    if (cid) {
      untrack(() => loadVideo(cid));
    } else {
      error = 'Invalid nhash format';
      loading = false;
    }
  });

  async function loadVideo(cidParam: CID) {
    console.log('[VideoNHashView] loadVideo called with CID:', cidParam);
    error = null;
    loading = true;
    videoSrc = '';

    // nhash points directly to video file blob
    // Filename is a hint for MIME type - if nhash is a directory, SW looks up the file;
    // if nhash is a file CID, SW uses the filename just for Content-Type
    videoCid = cidParam;
    const url = getNhashFileUrl(cidParam, 'video.mp4');
    console.log('[VideoNHashView] Setting videoSrc to:', url);
    videoSrc = url;
    loading = false;
  }

  function handleShare() {
    const url = window.location.href;
    openShareModal(url);
  }

  function handleDownload() {
    if (!videoCid) return;
    const swUrl = getNhashFileUrl(videoCid) + '?download=1';
    window.location.href = swUrl;
  }
</script>

<div class="flex-1 overflow-auto">
  <!-- Video Player - full width, sensible height like YouTube -->
  <div class="w-full max-w-full bg-black overflow-hidden mx-auto" style="height: min(calc(100vh - 48px - 180px), 80vh); aspect-ratio: 16/9;" data-testid="video-container">
    {#if loading}
      <div class="w-full h-full flex items-center justify-center text-white text-sm" data-testid="video-loading">
        <span class="i-lucide-loader-2 text-4xl text-text-3 animate-spin"></span>
      </div>
    {:else if error}
      <div class="w-full h-full flex items-center justify-center text-red-400" data-testid="video-error">
        <span class="i-lucide-alert-circle mr-2"></span>
        {error}
      </div>
    {:else}
      <!-- svelte-ignore a11y_media_has_caption -->
      <video
        bind:this={videoRef}
        src={videoSrc}
        class="w-full h-full"
        controls
        autoplay
        playsinline
        data-testid="video-player"
      />
    {/if}
  </div>

  <!-- Video info -->
  <div class="max-w-4xl mx-auto px-4 py-4 space-y-3">
    <!-- Actions -->
    <div class="flex items-center gap-2 flex-wrap">
      <button onclick={handleShare} class="btn-ghost" title="Share">
        <span class="i-lucide-share text-base"></span>
        <span class="hidden sm:inline ml-1">Share</span>
      </button>
      <button onclick={handleDownload} class="btn-ghost" disabled={!videoCid} title="Download">
        <span class="i-lucide-download text-base"></span>
        <span class="hidden sm:inline ml-1">Download</span>
      </button>
    </div>

    <!-- Permalink info -->
    <div class="bg-surface-1 rounded-lg p-3 text-sm text-text-3">
      <p>This is a content-addressed permalink. The video is identified by its ID, not by any user or channel.</p>
    </div>

    <!-- Comments -->
    <VideoComments {nhash} filename="video.mp4" />
  </div>
</div>
