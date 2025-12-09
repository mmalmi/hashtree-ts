<script lang="ts">
  /**
   * LiveVideoViewer - Video player with MSE for live streaming
   *
   * Uses MediaSource Extensions to progressively play video as chunks arrive.
   * Detects live streams via:
   * - ?live=1 hash param (from shared link or stream recording)
   * - recentlyChangedFiles store (local session only)
   * Seeks to near-live position (5s from end) for live streams.
   */
  import { getTree } from '../../store';
  import { recentlyChangedFiles } from '../../stores/recentlyChanged';
  import { currentHash } from '../../stores';
  import type { CID } from 'hashtree';

  interface Props {
    cid: CID;
    fileName: string;
  }

  let { cid, fileName }: Props = $props();

  let videoRef: HTMLVideoElement | undefined = $state();
  let mediaSource: MediaSource | null = $state(null);
  let sourceBuffer: SourceBuffer | null = $state(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let isLive = $state(false);
  let duration = $state(0);
  let currentTime = $state(0);
  let bufferedEnd = $state(0);

  // Check if live=1 is in URL hash params
  let hash = $derived($currentHash);
  let isLiveFromUrl = $derived.by(() => {
    const qIdx = hash.indexOf('?');
    if (qIdx === -1) return false;
    const params = new URLSearchParams(hash.slice(qIdx + 1));
    return params.get('live') === '1';
  });

  // Check if file is live (recently changed in this session)
  let changedFiles = $derived($recentlyChangedFiles);
  let isRecentlyChanged = $derived(changedFiles.has(fileName));

  // Combined live detection: URL param OR recently changed
  let shouldTreatAsLive = $derived(isLiveFromUrl || isRecentlyChanged);

  // Remove ?live=1 from URL when stream ends
  function removeLiveParam() {
    const hashBase = window.location.hash.split('?')[0];
    const qIdx = window.location.hash.indexOf('?');
    if (qIdx === -1) return;

    const params = new URLSearchParams(window.location.hash.slice(qIdx + 1));
    if (!params.has('live')) return;

    params.delete('live');
    const queryString = params.toString();
    window.location.hash = queryString ? `${hashBase}?${queryString}` : hashBase;
    isLive = false;
  }

  // Watch for stream becoming non-live (file no longer being updated)
  // Remove ?live=1 from URL when this happens
  let liveParamRemovalScheduled = false;
  $effect(() => {
    // If we have ?live=1 in URL but file is no longer recently changed,
    // the stream has ended - remove the param after video finishes loading
    if (isLiveFromUrl && !isRecentlyChanged && !loading && !liveParamRemovalScheduled) {
      liveParamRemovalScheduled = true;
      // Small delay to allow any final processing
      setTimeout(() => {
        removeLiveParam();
      }, 500);
    }
  });

  // Determine MIME type from extension
  function getMimeType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    const mimeTypes: Record<string, string> = {
      'webm': 'video/webm; codecs="vp8, opus"',
      'mp4': 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"',
    };
    return mimeTypes[ext] || 'video/webm; codecs="vp8, opus"';
  }

  // Check if MSE is supported for this mime type
  function isMseSupported(mimeType: string): boolean {
    return 'MediaSource' in window && MediaSource.isTypeSupported(mimeType);
  }

  // Load video using MSE
  async function loadWithMse() {
    const mimeType = getMimeType(fileName);

    if (!isMseSupported(mimeType)) {
      // Fall back to blob URL for unsupported types
      await loadWithBlobUrl();
      return;
    }

    try {
      mediaSource = new MediaSource();

      if (!videoRef) return;
      videoRef.src = URL.createObjectURL(mediaSource);

      await new Promise<void>((resolve, reject) => {
        mediaSource!.addEventListener('sourceopen', () => resolve(), { once: true });
        mediaSource!.addEventListener('error', (e) => reject(e), { once: true });
      });

      sourceBuffer = mediaSource.addSourceBuffer(mimeType);

      // Stream chunks into the source buffer
      const tree = getTree();
      let bytesLoaded = 0;

      for await (const chunk of tree.readFileStream(cid)) {
        // Wait for buffer to be ready
        while (sourceBuffer.updating) {
          await new Promise(r => setTimeout(r, 10));
        }

        sourceBuffer.appendBuffer(chunk);
        bytesLoaded += chunk.length;

        // Update buffered info
        if (sourceBuffer.buffered.length > 0) {
          bufferedEnd = sourceBuffer.buffered.end(sourceBuffer.buffered.length - 1);
        }

        // Wait for append to complete
        await new Promise<void>((resolve) => {
          if (!sourceBuffer!.updating) {
            resolve();
          } else {
            sourceBuffer!.addEventListener('updateend', () => resolve(), { once: true });
          }
        });
      }

      // End the stream
      if (mediaSource.readyState === 'open') {
        mediaSource.endOfStream();
      }

      // Update duration
      if (videoRef) {
        duration = videoRef.duration;
      }

      // If live, seek to near the end
      if (shouldTreatAsLive && videoRef && duration > 5) {
        videoRef.currentTime = Math.max(0, duration - 5);
        isLive = true;
      }

      loading = false;
    } catch (e) {
      console.error('MSE error:', e);
      // Fall back to blob URL
      await loadWithBlobUrl();
    }
  }

  // Fallback: load entire file as blob URL
  async function loadWithBlobUrl() {
    try {
      const tree = getTree();
      const data = await tree.readFile(cid);

      if (!data) {
        error = 'Failed to load video';
        loading = false;
        return;
      }

      const mimeType = getMimeType(fileName).split(';')[0];
      const blob = new Blob([data], { type: mimeType });

      if (videoRef) {
        videoRef.src = URL.createObjectURL(blob);

        videoRef.addEventListener('loadedmetadata', () => {
          duration = videoRef!.duration;

          // If live, seek to near the end
          if (shouldTreatAsLive && duration > 5) {
            videoRef!.currentTime = Math.max(0, duration - 5);
            isLive = true;
          }
        }, { once: true });
      }

      loading = false;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load video';
      loading = false;
    }
  }

  // Update current time
  function handleTimeUpdate() {
    if (videoRef) {
      currentTime = videoRef.currentTime;
    }
  }

  // Format time as mm:ss
  function formatTime(seconds: number): string {
    if (!isFinite(seconds)) return '--:--';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  // Cleanup on destroy
  $effect(() => {
    return () => {
      if (videoRef?.src) {
        URL.revokeObjectURL(videoRef.src);
      }
    };
  });

  // Load video when component mounts - use flag to prevent re-running
  let hasStartedLoading = false;
  $effect(() => {
    if (videoRef && !hasStartedLoading) {
      hasStartedLoading = true;
      loadWithMse();
    }
  });
</script>

<div class="flex-1 flex flex-col min-h-0 bg-black">
  <div class="relative flex-1 flex flex-col">
    <!-- Loading overlay -->
    {#if loading}
      <div class="absolute inset-0 flex items-center justify-center text-white bg-black z-20">
        <span class="i-lucide-loader-2 animate-spin mr-2"></span>
        Loading video...
      </div>
    {/if}

    <!-- Error overlay -->
    {#if error}
      <div class="absolute inset-0 flex items-center justify-center text-red-400 bg-black z-20">
        <span class="i-lucide-alert-circle mr-2"></span>
        {error}
      </div>
    {/if}

    <!-- Live indicator -->
    {#if (isLive || shouldTreatAsLive) && !loading && !error}
      <div class="absolute top-3 left-3 z-10 flex items-center gap-2 px-2 py-1 bg-red-600 text-white text-sm font-bold rounded">
        <span class="w-2 h-2 bg-white rounded-full animate-pulse"></span>
        LIVE
      </div>
    {/if}

    <!-- Video element (always rendered to allow binding) -->
    <!-- svelte-ignore a11y_media_has_caption -->
    <video
      bind:this={videoRef}
      controls
      autoplay={isLive || shouldTreatAsLive}
      class="w-full h-full object-contain"
      class:invisible={loading || error}
      preload="metadata"
      ontimeupdate={handleTimeUpdate}
    >
      Your browser does not support the video tag.
    </video>

    <!-- Duration/time info -->
    {#if !loading && !error}
      <div class="absolute bottom-16 right-3 z-10 px-2 py-1 bg-black/70 text-white text-sm rounded">
        {formatTime(currentTime)} / {formatTime(duration)}
      </div>
    {/if}
  </div>
</div>
