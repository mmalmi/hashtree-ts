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
      return nhashDecode(nhash);
    } catch (e) {
      console.error('Failed to decode nhash:', e);
      return null;
    }
  });

  // Load video when nhash changes
  $effect(() => {
    const cid = decodedCid;
    if (cid) {
      untrack(() => loadVideo(cid));
    } else {
      error = 'Invalid nhash format';
      loading = false;
    }
  });

  async function loadVideo(cidParam: CID) {
    error = null;
    loading = true;
    videoSrc = '';

    // nhash points directly to video file blob, not a directory
    videoCid = cidParam;
    videoSrc = getNhashFileUrl(cidParam);
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
  <div class="w-full max-w-full bg-black overflow-hidden mx-auto" style="height: min(calc(100vh - 48px - 180px), 80vh); aspect-ratio: 16/9;">
    {#if loading}
      <div class="w-full h-full flex items-center justify-center text-white text-sm">
        <span class="i-lucide-loader-2 text-4xl text-text-3 animate-spin"></span>
      </div>
    {:else if error}
      <div class="w-full h-full flex items-center justify-center text-red-400">
        <span class="i-lucide-alert-circle mr-2"></span>
        {error}
      </div>
    {:else if videoSrc}
      <!-- svelte-ignore a11y_media_has_caption -->
      <video
        bind:this={videoRef}
        src={videoSrc}
        class="w-full h-full"
        controls
        autoplay
        playsinline
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
    <VideoComments {nhash} />
  </div>
</div>
