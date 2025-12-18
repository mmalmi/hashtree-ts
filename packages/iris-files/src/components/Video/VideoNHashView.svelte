<script lang="ts">
  /**
   * VideoNHashView - Video player for content-addressed permalinks
   * Displays video from an nhash (no owner context, just the content)
   */
  import { untrack } from 'svelte';
  import { nhashDecode, type CID } from 'hashtree';
  import { getTree } from '../../store';
  import { openShareModal } from '../../stores/modals';
  import { getNhashFileUrl } from '../../lib/mediaUrl';
  import VideoComments from './VideoComments.svelte';

  interface Props {
    nhash: string;
  }

  let { nhash }: Props = $props();

  let videoSrc = $state<string>('');
  let videoFileName = $state<string>('');
  let loading = $state(true);
  let error = $state<string | null>(null);
  let videoTitle = $state<string>('');
  let videoDescription = $state<string>('');
  let videoCid = $state<CID | null>(null);
  let rootCid = $state<CID | null>(null);
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
      rootCid = cid;
      untrack(() => loadVideo(cid));
    } else {
      error = 'Invalid nhash format';
      loading = false;
    }
  });

  async function loadVideo(rootCidParam: CID) {
    error = null;
    loading = true;
    videoSrc = '';

    const tree = getTree();

    // Try common video filenames
    const commonNames = ['video.webm', 'video.mp4', 'video.mov'];
    for (const name of commonNames) {
      try {
        const result = await tree.resolvePath(rootCidParam, name);
        if (result) {
          videoCid = result.cid;
          videoFileName = name;
          videoSrc = getNhashFileUrl(result.cid, name);
          loading = false;
          break;
        }
      } catch {}
    }

    // If common names didn't work, list directory to find video
    if (!videoSrc) {
      try {
        const dir = await tree.listDirectory(rootCidParam);
        const videoEntry = dir?.find(e =>
          e.name.startsWith('video.') ||
          e.name.endsWith('.webm') ||
          e.name.endsWith('.mp4') ||
          e.name.endsWith('.mov')
        );

        if (videoEntry) {
          const videoResult = await tree.resolvePath(rootCidParam, videoEntry.name);
          if (videoResult) {
            videoCid = videoResult.cid;
            videoFileName = videoEntry.name;
            videoSrc = getNhashFileUrl(videoResult.cid, videoEntry.name);
            loading = false;
          }
        }
      } catch {}
    }

    if (!videoSrc) {
      error = 'Video file not found';
      loading = false;
      return;
    }

    // Load metadata in background
    loadMetadata(rootCidParam, tree);
  }

  async function loadMetadata(rootCid: CID, tree: ReturnType<typeof getTree>) {
    // Load title.txt
    try {
      const titleResult = await tree.resolvePath(rootCid, 'title.txt');
      if (titleResult) {
        const titleData = await tree.readFile(titleResult.cid);
        if (titleData) {
          videoTitle = new TextDecoder().decode(titleData);
        }
      }
    } catch {}

    // Load description.txt
    try {
      const descResult = await tree.resolvePath(rootCid, 'description.txt');
      if (descResult) {
        const descData = await tree.readFile(descResult.cid);
        if (descData) {
          videoDescription = new TextDecoder().decode(descData);
        }
      }
    } catch {}
  }

  function handleShare() {
    const url = window.location.href;
    openShareModal(url);
  }

  function handleDownload() {
    if (!videoCid || !videoFileName) return;
    const swUrl = getNhashFileUrl(videoCid, videoFileName) + '?download=1';
    window.location.href = swUrl;
  }

  // Display title
  let title = $derived(videoTitle || 'Video');
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
    <h1 class="text-xl font-semibold text-text-1">{title}</h1>

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

    <!-- Description -->
    {#if videoDescription}
      <div class="bg-surface-1 rounded-lg p-3">
        <p class="text-sm text-text-2 whitespace-pre-wrap">{videoDescription}</p>
      </div>
    {/if}

    <!-- Permalink info -->
    <div class="bg-surface-1 rounded-lg p-3 text-sm text-text-3">
      <p>This is a content-addressed permalink. The video is identified by its ID, not by any user or channel.</p>
    </div>

    <!-- Comments -->
    <VideoComments {nhash} />
  </div>
</div>
