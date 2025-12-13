<script lang="ts">
  /**
   * MediaPlayer - Streaming media player for video and audio
   *
   * Uses MediaSource Extensions to progressively play media as chunks arrive.
   * For video: Uses MSE when supported, falls back to blob URL
   * For audio: Uses blob URL (MSE audio codec support is limited)
   *
   * Live streaming features:
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
    /** Media type: 'video' or 'audio' */
    type?: 'video' | 'audio';
  }

  let props: Props = $props();
  // Derive from props to ensure reactivity
  let cid = $derived(props.cid);
  let fileName = $derived(props.fileName);
  let mediaType = $derived(props.type ?? 'video');
  let isAudio = $derived(mediaType === 'audio');

  let mediaRef: HTMLVideoElement | HTMLAudioElement | undefined = $state();
  let mediaSource: MediaSource | null = $state(null);
  let sourceBuffer: SourceBuffer | null = $state(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let isLive = $state(false);
  let duration = $state(0);
  let currentTime = $state(0);
  let bufferedEnd = $state(0);
  let paused = $state(true);

  // Track bytes loaded for incremental fetching
  let bytesLoaded = $state(0);
  let lastCidHash = $state<string | null>(null);

  // Abort controller for cancelling streaming on unmount
  let abortController: AbortController | null = null;

  // Polling interval for live streams
  let livePollingInterval: ReturnType<typeof setInterval> | null = null;
  const LIVE_POLL_INTERVAL = 2000; // Poll every 2 seconds for new data

  // Track last time we received new data (for detecting stream end)
  let lastDataReceivedTime = $state(0);
  const STREAM_TIMEOUT = 10000; // Consider stream ended if no new data for 10 seconds

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

  // Watch for stream becoming non-live (no new data for STREAM_TIMEOUT)
  let streamEndCheckInterval: ReturnType<typeof setInterval> | null = null;

  $effect(() => {
    // Only start checking for stream end when we're in live mode and done loading
    if (shouldTreatAsLive && !loading && lastDataReceivedTime > 0) {
      // Clear any existing interval
      if (streamEndCheckInterval) {
        clearInterval(streamEndCheckInterval);
      }

      // Periodically check if stream has timed out
      streamEndCheckInterval = setInterval(() => {
        const timeSinceLastData = Date.now() - lastDataReceivedTime;
        if (timeSinceLastData > STREAM_TIMEOUT) {
          // Stream has ended - no new data for STREAM_TIMEOUT
          if (streamEndCheckInterval) {
            clearInterval(streamEndCheckInterval);
            streamEndCheckInterval = null;
          }

          // Remove live param if it was in URL
          if (isLiveFromUrl) {
            removeLiveParam();
          }

          // Stop polling
          stopLivePolling();

          // Mark as fully loaded and close the MediaSource
          isFullyLoaded = true;
          if (mediaSource && mediaSource.readyState === 'open') {
            try {
              mediaSource.endOfStream();
            } catch {
              // Ignore errors
            }
          }
        }
      }, 2000); // Check every 2 seconds
    }

    // Cleanup on unmount or when leaving live mode
    return () => {
      if (streamEndCheckInterval) {
        clearInterval(streamEndCheckInterval);
        streamEndCheckInterval = null;
      }
    };
  });

  // Determine MIME type from extension
  function getMimeType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    const mimeTypes: Record<string, string> = {
      // Video - don't specify codecs, let MSE auto-detect from container
      'webm': 'video/webm',
      'mp4': 'video/mp4',
      'ogg': 'video/ogg',
      'ogv': 'video/ogg',
      'mov': 'video/quicktime',
      'avi': 'video/x-msvideo',
      'mkv': 'video/x-matroska',
      // Audio
      'mp3': 'audio/mpeg',
      'wav': 'audio/wav',
      'flac': 'audio/flac',
      'm4a': 'audio/mp4',
      'aac': 'audio/aac',
      'oga': 'audio/ogg',
    };
    return mimeTypes[ext] || (isAudio ? 'audio/mpeg' : 'video/webm');
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

  // Buffer size constants
  const INITIAL_BUFFER_SIZE = 1024 * 1024; // 1MB initial load
  const BUFFER_AHEAD_SIZE = 512 * 1024; // 512KB fetch at a time
  const BUFFER_THRESHOLD = 5; // Start fetching when buffer < 5 seconds ahead

  // Track if we've loaded all data
  let isFullyLoaded = $state(false);
  let isFetching = $state(false);
  let totalFileSize = $state<number | null>(null);

  // Fetch more data when buffer runs low
  async function fetchMoreData() {
    if (isFetching || isFullyLoaded || !sourceBuffer || !mediaSource || mediaSource.readyState !== 'open') {
      return;
    }

    // Check if we need more data based on buffer state
    if (mediaRef && sourceBuffer.buffered.length > 0) {
      const bufferedTime = sourceBuffer.buffered.end(sourceBuffer.buffered.length - 1);
      const bufferAhead = bufferedTime - mediaRef.currentTime;

      // Only fetch if buffer is running low (less than threshold seconds ahead)
      if (bufferAhead > BUFFER_THRESHOLD && !shouldTreatAsLive) {
        return;
      }
    }

    isFetching = true;

    try {
      const tree = getTree();
      const data = await tree.readFileRange(cid, bytesLoaded, bytesLoaded + BUFFER_AHEAD_SIZE);

      if (!data || data.length === 0) {
        // No more data - we've loaded everything
        isFullyLoaded = true;
        if (mediaSource.readyState === 'open' && !shouldTreatAsLive) {
          mediaSource.endOfStream();
        }
      } else {
        await appendToSourceBuffer(data);
        bytesLoaded += data.length;

        // Update duration after new data
        if (mediaRef && !isNaN(mediaRef.duration) && isFinite(mediaRef.duration)) {
          duration = mediaRef.duration;
        }

        // Check if we got less than requested - means we're at the end
        if (data.length < BUFFER_AHEAD_SIZE) {
          isFullyLoaded = true;
          if (mediaSource.readyState === 'open' && !shouldTreatAsLive) {
            mediaSource.endOfStream();
          }
        }
      }
    } catch (e) {
      console.error('Error fetching more data:', e);
    } finally {
      isFetching = false;
    }
  }

  // Check if file format supports MSE streaming
  // MSE requires fragmented formats - regular MP4 won't work
  function canUseMseForFormat(filename: string): boolean {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    // Only WebM reliably supports MSE streaming
    // Regular MP4 files are not fragmented and will fail
    return ext === 'webm';
  }

  // Load media using MSE for streaming playback
  async function loadMedia() {
    if (!cid?.hash) {
      error = 'No file CID';
      loading = false;
      return;
    }

    const mimeType = getMimeType(fileName);

    // For live streams with MSE-compatible formats (WebM), use MSE
    // For everything else, use blob URL - browser handles buffering natively
    if (shouldTreatAsLive && canUseMseForFormat(fileName) && isMseSupported(mimeType)) {
      await loadWithMse();
    } else {
      await loadWithBlobUrl();
    }
  }

  // MSE-based streaming - allows playback to start before full load
  async function loadWithMse() {
    const mimeType = getMimeType(fileName);

    try {
      mediaSource = new MediaSource();

      if (!mediaRef) {
        return;
      }
      mediaRef.src = URL.createObjectURL(mediaSource);

      abortController = new AbortController();
      const signal = abortController.signal;

      await new Promise<void>((resolve, reject) => {
        mediaSource!.addEventListener('sourceopen', () => resolve(), { once: true });
        mediaSource!.addEventListener('error', (e) => reject(e), { once: true });
      });

      if (signal.aborted) return;

      sourceBuffer = mediaSource.addSourceBuffer(mimeType);

      const tree = getTree();

      // Collect all chunks first (prefetch for network efficiency)
      const chunks: Uint8Array[] = [];
      for await (const chunk of tree.readFileStream(cid, { prefetch: 5 })) {
        if (signal.aborted) break;
        chunks.push(chunk);
        bytesLoaded += chunk.length;
      }

      if (signal.aborted) return;

      // Now append all chunks to MSE
      // We batch them to avoid too many small appends
      const BATCH_SIZE = 512 * 1024; // 512KB batches
      let currentBatch: Uint8Array[] = [];
      let currentBatchSize = 0;

      for (const chunk of chunks) {
        currentBatch.push(chunk);
        currentBatchSize += chunk.length;

        if (currentBatchSize >= BATCH_SIZE) {
          // Merge batch into single buffer
          const merged = new Uint8Array(currentBatchSize);
          let offset = 0;
          for (const c of currentBatch) {
            merged.set(c, offset);
            offset += c.length;
          }

          if (mediaSource?.readyState !== 'open') break;
          await appendToSourceBuffer(merged);

          // Hide loading after first batch is appended
          if (loading) {
            loading = false;
          }

          currentBatch = [];
          currentBatchSize = 0;
        }
      }

      // Append remaining data
      if (currentBatch.length > 0 && mediaSource?.readyState === 'open') {
        const merged = new Uint8Array(currentBatchSize);
        let offset = 0;
        for (const c of currentBatch) {
          merged.set(c, offset);
          offset += c.length;
        }
        await appendToSourceBuffer(merged);
      }

      loading = false;
      // For live streams, don't mark as fully loaded - we'll poll for more data
      isFullyLoaded = !shouldTreatAsLive;
      lastCidHash = toHex(cid.hash);
      lastDataReceivedTime = Date.now();

      if (mediaRef && !isNaN(mediaRef.duration) && isFinite(mediaRef.duration)) {
        duration = mediaRef.duration;
      }

      if (shouldTreatAsLive && mediaRef && duration > 5) {
        mediaRef.currentTime = Math.max(0, duration - 5);
        isLive = true;
      }

      if (!shouldTreatAsLive && mediaSource.readyState === 'open') {
        mediaSource.endOfStream();
      }

      // Start polling for live streams
      if (shouldTreatAsLive) {
        startLivePolling();
      }
    } catch (e) {
      console.error('MSE error:', e);
      await loadWithBlobUrl();
    }
  }

  // Track if we're using blob URL mode (for live stream reload handling)
  let usingBlobUrl = $state(false);

  // Load file as blob URL with progress
  async function loadWithBlobUrl() {
    usingBlobUrl = true;
    try {
      const tree = getTree();
      const chunks: Uint8Array[] = [];

      // Stream chunks to show loading progress
      for await (const chunk of tree.readFileStream(cid, { prefetch: 5 })) {
        chunks.push(chunk);
        bytesLoaded += chunk.length;
      }

      if (chunks.length === 0) {
        error = 'Failed to load media';
        loading = false;
        return;
      }

      lastCidHash = toHex(cid.hash);
      // For live streams in blob URL mode, don't mark as fully loaded
      // We'll reload when CID changes
      isFullyLoaded = !shouldTreatAsLive;
      lastDataReceivedTime = Date.now();

      const mimeType = getMimeType(fileName).split(';')[0];
      const blob = new Blob(chunks, { type: mimeType });

      if (mediaRef) {
        // Clean up previous blob URL
        if (mediaRef.src && mediaRef.src.startsWith('blob:')) {
          URL.revokeObjectURL(mediaRef.src);
        }
        mediaRef.src = URL.createObjectURL(blob);

        mediaRef.addEventListener('loadedmetadata', () => {
          duration = mediaRef!.duration;

          if (shouldTreatAsLive && duration > 5) {
            mediaRef!.currentTime = Math.max(0, duration - 5);
            isLive = true;
          }
        }, { once: true });
      }

      loading = false;

      // Start polling for live streams to check for CID changes
      if (shouldTreatAsLive) {
        startLivePolling();
      }
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load media';
      loading = false;
    }
  }

  // Reload blob URL when CID changes (for live streams not using MSE)
  async function reloadBlobUrl() {
    if (!usingBlobUrl || !shouldTreatAsLive || !mediaRef) return;

    const currentCidHash = toHex(cid.hash);
    if (currentCidHash === lastCidHash) return;

    // Remember current playback position
    const currentPlaybackTime = mediaRef.currentTime;
    const wasPlaying = !mediaRef.paused;

    try {
      const tree = getTree();
      const chunks: Uint8Array[] = [];
      let newBytesLoaded = 0;

      for await (const chunk of tree.readFileStream(cid, { prefetch: 5 })) {
        chunks.push(chunk);
        newBytesLoaded += chunk.length;
      }

      if (chunks.length === 0) return;

      // Only update if we got more data
      if (newBytesLoaded <= bytesLoaded) return;

      bytesLoaded = newBytesLoaded;
      lastCidHash = currentCidHash;
      lastDataReceivedTime = Date.now();

      const mimeType = getMimeType(fileName).split(';')[0];
      const blob = new Blob(chunks, { type: mimeType });

      // Clean up previous blob URL
      if (mediaRef.src && mediaRef.src.startsWith('blob:')) {
        URL.revokeObjectURL(mediaRef.src);
      }

      mediaRef.src = URL.createObjectURL(blob);

      // Restore playback state after loading new data
      mediaRef.addEventListener('loadedmetadata', () => {
        duration = mediaRef!.duration;

        // For live streams, jump to near the end to show latest content
        if (duration > 5) {
          mediaRef!.currentTime = Math.max(currentPlaybackTime, duration - 3);
        }

        if (wasPlaying) {
          mediaRef!.play().catch(() => {});
        }
      }, { once: true });

    } catch (e) {
      console.error('[MediaPlayer] Error reloading blob URL:', e);
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
        if (mediaRef && !isNaN(mediaRef.duration)) {
          duration = mediaRef.duration;
        }
      }

      lastCidHash = currentCidHash;
    } catch (e) {
      console.error('Error fetching new data:', e);
    }
  }

  // Track if we're currently polling (to avoid overlapping polls)
  let isPolling = false;

  // Poll for new data at the current CID (for live streams)
  // This handles cases where:
  // 1. The CID prop updated but we need to fetch data from peers
  // 2. The stream is growing but CID updates haven't arrived yet
  async function pollForNewData() {
    // Avoid overlapping polls
    if (isPolling) return;

    // Skip if we're not in live mode or still loading
    if (!shouldTreatAsLive || loading) {
      return;
    }

    // For blob URL mode, check if CID changed and reload
    if (usingBlobUrl) {
      const currentCidHash = toHex(cid.hash);
      if (currentCidHash !== lastCidHash) {
        isPolling = true;
        try {
          await reloadBlobUrl();
        } finally {
          isPolling = false;
        }
      }
      return;
    }

    // MSE mode - need source buffer
    if (!sourceBuffer || !mediaSource || mediaSource.readyState !== 'open') {
      return;
    }

    isPolling = true;

    try {
      const tree = getTree();
      const currentCidHash = toHex(cid.hash);

      // Try to fetch more data from the current (or updated) CID
      const newData = await tree.readFileRange(cid, bytesLoaded);

      if (newData && newData.length > 0) {
        await appendToSourceBuffer(newData);
        bytesLoaded += newData.length;
        lastDataReceivedTime = Date.now();

        // Update duration
        if (mediaRef && !isNaN(mediaRef.duration) && isFinite(mediaRef.duration)) {
          duration = mediaRef.duration;
        }

        // Update last CID hash to track that we've processed this version
        lastCidHash = currentCidHash;
      }
    } catch (e) {
      // Silently ignore errors during polling - data might not be available yet
      // This is expected when the viewer hasn't synced the latest chunks
    } finally {
      isPolling = false;
    }
  }

  // Start polling for new data in live mode
  function startLivePolling() {
    // Clear any existing interval
    if (livePollingInterval) {
      clearInterval(livePollingInterval);
    }

    // Start polling
    livePollingInterval = setInterval(() => {
      pollForNewData();
    }, LIVE_POLL_INTERVAL);
  }

  // Stop polling
  function stopLivePolling() {
    if (livePollingInterval) {
      clearInterval(livePollingInterval);
      livePollingInterval = null;
    }
  }

  // Watch for CID changes in live mode
  // Access cid.hash directly to ensure reactivity
  let currentCidHashReactive = $derived(cid?.hash ? toHex(cid.hash) : null);

  $effect(() => {
    if (!shouldTreatAsLive || loading) return;

    const currentCidHash = currentCidHashReactive;
    if (currentCidHash && currentCidHash !== lastCidHash) {
      // For MSE mode, append new data incrementally
      // For blob URL mode, reload the entire file
      if (usingBlobUrl) {
        reloadBlobUrl();
      } else {
        fetchNewData();
      }
    }
  });

  // Update current time and check if we need more buffer
  function handleTimeUpdate() {
    if (mediaRef) {
      currentTime = mediaRef.currentTime;

      // Check if we need to fetch more data (buffered loading)
      if (!isFullyLoaded && !isFetching) {
        fetchMoreData();
      }
    }
  }

  // Track play/pause state
  function handlePlay() {
    paused = false;
  }

  function handlePause() {
    paused = true;
  }

  // Handle video waiting (stalled due to buffering)
  // For live streams, try to fetch more data immediately
  function handleWaiting() {
    if (shouldTreatAsLive && !isPolling) {
      // Immediately poll for new data when video stalls
      pollForNewData();
    }
  }

  // Toggle play/pause
  function togglePlay() {
    if (!mediaRef) return;
    if (mediaRef.paused) {
      mediaRef.play();
    } else {
      mediaRef.pause();
    }
  }

  // Update duration when video metadata changes (new data appended)
  function handleDurationChange() {
    if (mediaRef && !isNaN(mediaRef.duration) && isFinite(mediaRef.duration)) {
      duration = mediaRef.duration;
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
      // Stop live polling
      stopLivePolling();

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
      if (mediaRef?.src) {
        URL.revokeObjectURL(mediaRef.src);
      }
    };
  });

  // Load media when component mounts
  let hasStartedLoading = false;
  $effect(() => {
    if (mediaRef && !hasStartedLoading) {
      hasStartedLoading = true;
      loadMedia().catch((e) => {
        console.error('Failed to load media:', e);
        error = e instanceof Error ? e.message : 'Failed to load media';
        loading = false;
      });
    }
  });
</script>

<div class="flex-1 flex flex-col min-h-0 overflow-hidden" class:bg-black={!isAudio} class:bg-surface-0={isAudio}>
  <div class="relative flex-1 flex flex-col items-center justify-center min-h-0" class:p-4={isAudio}>
    <!-- Loading overlay -->
    {#if loading}
      <div class="absolute inset-0 flex items-center justify-center text-white z-20" class:bg-black={!isAudio} class:bg-surface-0={isAudio} class:text-text-1={isAudio}>
        <div class="flex flex-col items-center gap-2">
          <span class="i-lucide-loader-2 animate-spin text-2xl"></span>
          <span>Loading {isAudio ? 'audio' : 'video'}...</span>
          {#if bytesLoaded > 0}
            <span class="text-sm opacity-70">
              {bytesLoaded < 1024 * 1024
                ? `${Math.round(bytesLoaded / 1024)}KB`
                : `${(bytesLoaded / (1024 * 1024)).toFixed(1)}MB`}
            </span>
          {/if}
        </div>
      </div>
    {/if}

    <!-- Error overlay -->
    {#if error}
      <div class="absolute inset-0 flex items-center justify-center text-red-400 z-20" class:bg-black={!isAudio} class:bg-surface-0={isAudio}>
        <span class="i-lucide-alert-circle mr-2"></span>
        {error}
      </div>
    {/if}

    <!-- Live indicator (video only) -->
    {#if !isAudio && (isLive || shouldTreatAsLive) && !loading && !error}
      <div class="absolute top-3 left-3 z-10 flex items-center gap-2 px-2 py-1 bg-red-600 text-white text-sm font-bold rounded">
        <span class="w-2 h-2 bg-white rounded-full animate-pulse"></span>
        LIVE
      </div>
    {/if}

    {#if isAudio}
      <!-- Audio visual placeholder -->
      <div class="w-full max-w-md flex flex-col items-center gap-4">
        <!-- Album art placeholder / visualizer area -->
        <div class="w-48 h-48 rounded-lg bg-surface-2 flex items-center justify-center shadow-lg">
          <span class="i-lucide-music text-6xl text-text-2"></span>
        </div>
        <!-- Audio element -->
        <audio
          bind:this={mediaRef}
          controls
          autoplay
          class="w-full"
          class:invisible={loading || error}
          preload="metadata"
          ontimeupdate={handleTimeUpdate}
          ondurationchange={handleDurationChange}
          onplay={handlePlay}
          onpause={handlePause}
          onwaiting={handleWaiting}
        >
          Your browser does not support the audio tag.
        </audio>
      </div>
    {:else}
      <!-- Video element -->
      <!-- svelte-ignore a11y_media_has_caption -->
      <video
        bind:this={mediaRef}
        controls
        autoplay
        class="max-w-full max-h-full object-contain"
        class:invisible={loading || error}
        preload="metadata"
        ontimeupdate={handleTimeUpdate}
        ondurationchange={handleDurationChange}
        onplay={handlePlay}
        onpause={handlePause}
        onwaiting={handleWaiting}
      >
        Your browser does not support the video tag.
      </video>

      <!-- Big play button overlay when paused (video only) -->
      {#if paused && !loading && !error}
        <button
          type="button"
          class="absolute inset-0 flex items-center justify-center z-10 cursor-pointer bg-transparent"
          onclick={togglePlay}
          aria-label="Play video"
        >
          <div class="w-20 h-20 rounded-full bg-white/90 flex items-center justify-center shadow-lg hover:bg-white hover:scale-110 transition-all">
            <span class="i-lucide-play w-10 h-10 text-black ml-1"></span>
          </div>
        </button>
      {/if}

      <!-- Duration/time info (video only) -->
      {#if !loading && !error}
        <div class="absolute bottom-16 right-3 z-10 px-2 py-1 bg-black/70 text-white text-sm rounded">
          {formatTime(currentTime)} / {formatTime(duration)}
          {#if shouldTreatAsLive}
            <span class="ml-2 text-xs text-gray-400">({Math.round(bytesLoaded / 1024)}KB)</span>
          {/if}
        </div>
      {/if}
    {/if}
  </div>
</div>
