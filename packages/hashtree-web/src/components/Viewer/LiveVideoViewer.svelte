<script lang="ts">
  /**
   * LiveVideoViewer - Video player with MSE for live streaming
   *
   * Uses MediaSource Extensions to progressively play video as chunks arrive.
   * For live streams:
   * - Detects live via ?live=1 hash param
   * - Watches for CID changes (new data published)
   * - Uses readFileRange to fetch only NEW bytes
   * - Appends incrementally to SourceBuffer
   */
  import { getTree } from '../../store';
  import { recentlyChangedFiles } from '../../stores/recentlyChanged';
  import { currentHash } from '../../stores';
  import { toHex, type CID } from 'hashtree';

  interface Props {
    cid: CID;
    fileName: string;
  }

  let props: Props = $props();
  // Derive from props to ensure reactivity
  let cid = $derived(props.cid);
  let fileName = $derived(props.fileName);

  let videoRef: HTMLVideoElement | undefined = $state();
  let mediaSource: MediaSource | null = $state(null);
  let sourceBuffer: SourceBuffer | null = $state(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let isLive = $state(false);
  let duration = $state(0);
  let currentTime = $state(0);
  let bufferedEnd = $state(0);

  // Track bytes loaded for incremental fetching
  let bytesLoaded = $state(0);
  let lastCidHash = $state<string | null>(null);

  // Abort controller for cancelling streaming on unmount
  let abortController: AbortController | null = null;

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

  // Watch for stream becoming non-live
  let liveParamRemovalScheduled = false;
  $effect(() => {
    if (isLiveFromUrl && !isRecentlyChanged && !loading && !liveParamRemovalScheduled) {
      liveParamRemovalScheduled = true;
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

  // Append data to source buffer, waiting for it to be ready
  async function appendToSourceBuffer(data: Uint8Array): Promise<void> {
    if (!sourceBuffer || !mediaSource || mediaSource.readyState !== 'open') {
      return;
    }

    // Wait for buffer to be ready (with timeout)
    let waitCount = 0;
    while (sourceBuffer.updating) {
      await new Promise(r => setTimeout(r, 10));
      waitCount++;
      if (waitCount > 100) {
        return;
      }
    }

    try {
      sourceBuffer.appendBuffer(data);

      // Wait for append to complete
      await new Promise<void>((resolve) => {
        if (!sourceBuffer!.updating) {
          resolve();
        } else {
          sourceBuffer!.addEventListener('updateend', () => resolve(), { once: true });
        }
      });

      // Update buffered info
      if (sourceBuffer.buffered.length > 0) {
        bufferedEnd = sourceBuffer.buffered.end(sourceBuffer.buffered.length - 1);
      }
    } catch {
      // Ignore errors - will fall back to blob URL if needed
    }
  }

  // Initial load with MSE
  async function loadWithMse() {
    if (!cid?.hash) {
      error = 'No file CID';
      loading = false;
      return;
    }

    const mimeType = getMimeType(fileName);

    if (!isMseSupported(mimeType)) {
      await loadWithBlobUrl();
      return;
    }

    try {
      mediaSource = new MediaSource();

      if (!videoRef) return;
      videoRef.src = URL.createObjectURL(mediaSource);

      // Create abort controller for this load
      abortController = new AbortController();
      const signal = abortController.signal;

      await new Promise<void>((resolve, reject) => {
        mediaSource!.addEventListener('sourceopen', () => resolve(), { once: true });
        mediaSource!.addEventListener('error', (e) => reject(e), { once: true });
      });

      if (signal.aborted) return;

      sourceBuffer = mediaSource.addSourceBuffer(mimeType);

      // Stream all available chunks
      const tree = getTree();

      for await (const chunk of tree.readFileStream(cid)) {
        if (signal.aborted || mediaSource?.readyState !== 'open') {
          // MSE closed - fall back to blob URL
          if (!signal.aborted && mediaSource?.readyState === 'closed') {
            await loadWithBlobUrl();
            return;
          }
          break;
        }
        await appendToSourceBuffer(chunk);
        bytesLoaded += chunk.length;
      }

      // Store current CID hash for change detection
      lastCidHash = toHex(cid.hash);

      // Update duration
      if (videoRef) {
        duration = videoRef.duration;
      }

      // If live, seek to near the end
      if (shouldTreatAsLive && videoRef && duration > 5) {
        videoRef.currentTime = Math.max(0, duration - 5);
        isLive = true;
      }

      // For live streams, don't end the stream yet - keep it open for new data
      if (!shouldTreatAsLive && mediaSource.readyState === 'open') {
        mediaSource.endOfStream();
      }

      loading = false;
    } catch (e) {
      console.error('MSE error:', e);
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

      bytesLoaded = data.length;
      lastCidHash = toHex(cid.hash);

      const mimeType = getMimeType(fileName).split(';')[0];
      const blob = new Blob([data], { type: mimeType });

      if (videoRef) {
        videoRef.src = URL.createObjectURL(blob);

        videoRef.addEventListener('loadedmetadata', () => {
          duration = videoRef!.duration;

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

  // Fetch and append only new data when CID changes
  async function fetchNewData() {
    if (!sourceBuffer || !mediaSource || mediaSource.readyState !== 'open') {
      return;
    }

    const currentCidHash = toHex(cid.hash);
    if (currentCidHash === lastCidHash) {
      return; // No change
    }

    try {
      const tree = getTree();

      // Fetch only bytes from our current offset onwards
      const newData = await tree.readFileRange(cid, bytesLoaded);

      if (newData && newData.length > 0) {
        await appendToSourceBuffer(newData);
        bytesLoaded += newData.length;

        // Update duration
        if (videoRef && !isNaN(videoRef.duration)) {
          duration = videoRef.duration;
        }
      }

      lastCidHash = currentCidHash;
    } catch (e) {
      console.error('Error fetching new data:', e);
    }
  }

  // Watch for CID changes in live mode
  // Access cid.hash directly to ensure reactivity
  let currentCidHashReactive = $derived(cid?.hash ? toHex(cid.hash) : null);

  $effect(() => {
    if (!shouldTreatAsLive || loading) return;

    const currentCidHash = currentCidHashReactive;
    if (currentCidHash && currentCidHash !== lastCidHash) {
      fetchNewData();
    }
  });

  // Update current time
  function handleTimeUpdate() {
    if (videoRef) {
      currentTime = videoRef.currentTime;
    }
  }

  // Update duration when video metadata changes (new data appended)
  function handleDurationChange() {
    if (videoRef && !isNaN(videoRef.duration) && isFinite(videoRef.duration)) {
      duration = videoRef.duration;
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
      // Abort any ongoing streaming
      if (abortController) {
        abortController.abort();
        abortController = null;
      }
      if (mediaSource && mediaSource.readyState === 'open') {
        try {
          mediaSource.endOfStream();
        } catch {
          // Ignore errors during cleanup
        }
      }
      if (videoRef?.src) {
        URL.revokeObjectURL(videoRef.src);
      }
    };
  });

  // Load video when component mounts
  let hasStartedLoading = false;
  $effect(() => {
    if (videoRef && !hasStartedLoading) {
      hasStartedLoading = true;
      loadWithMse().catch((e) => {
        console.error('Failed to load video:', e);
        error = e instanceof Error ? e.message : 'Failed to load video';
        loading = false;
      });
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
      autoplay
      class="w-full h-full object-contain"
      class:invisible={loading || error}
      preload="metadata"
      ontimeupdate={handleTimeUpdate}
      ondurationchange={handleDurationChange}
    >
      Your browser does not support the video tag.
    </video>

    <!-- Duration/time info -->
    {#if !loading && !error}
      <div class="absolute bottom-16 right-3 z-10 px-2 py-1 bg-black/70 text-white text-sm rounded">
        {formatTime(currentTime)} / {formatTime(duration)}
        {#if shouldTreatAsLive}
          <span class="ml-2 text-xs text-gray-400">({Math.round(bytesLoaded / 1024)}KB)</span>
        {/if}
      </div>
    {/if}
  </div>
</div>
