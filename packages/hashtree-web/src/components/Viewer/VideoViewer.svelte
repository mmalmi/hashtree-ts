<script lang="ts">
  /**
   * VideoViewer - plays video files using blob URLs
   * Supports mp4, webm, ogg video formats
   */
  import { getTree } from '../../store';
  import type { CID } from 'hashtree';

  interface Props {
    cid: CID;
    fileName: string;
  }

  let { cid, fileName }: Props = $props();

  let videoSrc = $state<string>('');
  let loading = $state(true);
  let error = $state<string | null>(null);

  // Determine MIME type from extension
  function getMimeType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    const mimeTypes: Record<string, string> = {
      'mp4': 'video/mp4',
      'webm': 'video/webm',
      'ogg': 'video/ogg',
      'ogv': 'video/ogg',
      'mov': 'video/quicktime',
      'avi': 'video/x-msvideo',
      'mkv': 'video/x-matroska',
    };
    return mimeTypes[ext] || 'video/mp4';
  }

  // Load video data and create blob URL
  $effect(() => {
    let cancelled = false;
    let currentBlobUrl = '';

    async function loadVideo() {
      loading = true;
      error = null;

      try {
        const tree = getTree();
        const data = await tree.readFile(cid);

        if (cancelled) return;

        if (!data) {
          error = 'Failed to load video';
          loading = false;
          return;
        }

        // Create blob URL
        const mimeType = getMimeType(fileName);
        const blob = new Blob([data], { type: mimeType });
        currentBlobUrl = URL.createObjectURL(blob);
        videoSrc = currentBlobUrl;
        loading = false;
      } catch (e) {
        if (!cancelled) {
          error = e instanceof Error ? e.message : 'Failed to load video';
          loading = false;
        }
      }
    }

    loadVideo();

    return () => {
      cancelled = true;
      if (currentBlobUrl) {
        URL.revokeObjectURL(currentBlobUrl);
      }
    };
  });
</script>

<div class="flex-1 flex flex-col min-h-0 bg-black">
  {#if loading}
    <div class="flex-1 flex items-center justify-center text-white">
      <span class="i-lucide-loader-2 animate-spin mr-2"></span>
      Loading video...
    </div>
  {:else if error}
    <div class="flex-1 flex items-center justify-center text-red-400">
      <span class="i-lucide-alert-circle mr-2"></span>
      {error}
    </div>
  {:else if videoSrc}
    <!-- svelte-ignore a11y_media_has_caption -->
    <video
      src={videoSrc}
      controls
      class="w-full h-full object-contain"
      preload="metadata"
    >
      Your browser does not support the video tag.
    </video>
  {/if}
</div>
