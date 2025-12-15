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

  // Track if file has been updated (for blob URL mode - shows "Updated" button instead of auto-reload)
  let hasUpdate = $state(false);

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
          // Stream appears to have ended - no new data for STREAM_TIMEOUT
          console.log('[MediaPlayer] Stream timeout - no new data for', STREAM_TIMEOUT, 'ms');

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

          // Mark as fully loaded but DON'T close MediaSource
          // Keep it open so we can append more data if CID changes later
          isFullyLoaded = true;
          isLive = false;
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
      // WebM needs codec string for MSE - MediaRecorder uses vp8+opus
      'webm': 'video/webm;codecs=vp8,opus',
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
      await new Promise<void>((resolve, reject) => {
        if (!sourceBuffer!.updating) {
          resolve();
        } else {
          sourceBuffer!.addEventListener('updateend', () => resolve(), { once: true });
          sourceBuffer!.addEventListener('error', (e) => reject(e), { once: true });
        }
      });

      // Update buffered info
      if (sourceBuffer.buffered.length > 0) {
        bufferedEnd = sourceBuffer.buffered.end(sourceBuffer.buffered.length - 1);
      }
    } catch (e) {
      console.error('[MediaPlayer] MSE append error:', e);
      // Will fall back to blob URL if needed
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
        // No more data currently - but CID might update later, so don't close MediaSource
        isFullyLoaded = true;
      } else {
        await appendToSourceBuffer(data);
        bytesLoaded += data.length;

        // Update duration after new data
        if (mediaRef && !isNaN(mediaRef.duration) && isFinite(mediaRef.duration)) {
          duration = mediaRef.duration;
        }

        // Check if we got less than requested - means we're at the end for now
        if (data.length < BUFFER_AHEAD_SIZE) {
          isFullyLoaded = true;
          // Don't close MediaSource - CID might update with new data later
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

    // Use MSE for supported formats - allows progressive playback and smooth CID updates
    // Fall back to blob URL for unsupported formats
    if (canUseMseForFormat(fileName) && isMseSupported(mimeType)) {
      await loadWithMse();
    } else {
      await loadWithBlobUrl();
    }
  }

  // MSE-based streaming - allows playback to start before full load
  async function loadWithMse() {
    const mimeType = getMimeType(fileName);
    usingBlobUrl = false; // Explicitly mark as MSE mode

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
      console.log('[MediaPlayer] MSE source buffer created for', mimeType);

      // For MSE streaming, hide loading spinner immediately - video will show its own buffering state
      loading = false;
      console.log('[MediaPlayer] Loading spinner hidden, starting to stream chunks');

      // Listen for duration to become available (once header is parsed)
      if (mediaRef) {
        mediaRef.addEventListener('loadedmetadata', () => {
          if (mediaRef && !isNaN(mediaRef.duration) && isFinite(mediaRef.duration)) {
            duration = mediaRef.duration;
            console.log('[MediaPlayer] Duration from metadata:', duration);
          }
        }, { once: true });
      }

      const tree = getTree();

      // Stream chunks and append immediately as they arrive
      // Small batches (32KB) for fast initial playback while avoiding too many appendBuffer calls
      const BATCH_SIZE = 32 * 1024;
      let currentBatch: Uint8Array[] = [];
      let currentBatchSize = 0;
      let hasTriggeredPlay = false;

      for await (const chunk of tree.readFileStream(cid, { prefetch: 3 })) {
        if (signal.aborted) break;

        currentBatch.push(chunk);
        currentBatchSize += chunk.length;
        bytesLoaded += chunk.length;

        // Append batch when it reaches threshold
        if (currentBatchSize >= BATCH_SIZE) {
          const merged = new Uint8Array(currentBatchSize);
          let offset = 0;
          for (const c of currentBatch) {
            merged.set(c, offset);
            offset += c.length;
          }

          if (mediaSource?.readyState !== 'open') break;
          await appendToSourceBuffer(merged);
          console.log('[MediaPlayer] Appended', merged.length, 'bytes, total:', bytesLoaded, 'buffered:', bufferedEnd.toFixed(2) + 's');

          // Try to start playback after first chunk is appended
          if (!hasTriggeredPlay && mediaRef) {
            hasTriggeredPlay = true;
            console.log('[MediaPlayer] Triggering play(), buffered:', sourceBuffer?.buffered.length, 'ranges');
            mediaRef.play().catch((e) => {
              console.log('[MediaPlayer] Autoplay blocked:', e.message);
            });
          }

          currentBatch = [];
          currentBatchSize = 0;
        }
      }

      if (signal.aborted) return;

      // Append any remaining data
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
      // Don't mark as fully loaded - CID may change and we'll need to append more
      isFullyLoaded = false;
      lastCidHash = toHex(cid.hash);
      lastDataReceivedTime = Date.now();

      if (mediaRef && !isNaN(mediaRef.duration) && isFinite(mediaRef.duration)) {
        duration = mediaRef.duration;
      }

      // For live streams, seek near end and start polling
      if (shouldTreatAsLive && mediaRef && isFinite(duration) && duration > 5) {
        mediaRef.currentTime = Math.max(0, duration - 5);
        isLive = true;
        startLivePolling();
      }
      // Don't call endOfStream() - keep MediaSource open for potential CID updates
      console.log('[MediaPlayer] MSE initial load complete, live:', shouldTreatAsLive, 'duration:', duration);
    } catch (e) {
      console.error('[MediaPlayer] MSE failed, falling back to blob URL:', e);
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

          if (shouldTreatAsLive && isFinite(duration) && duration > 5) {
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

  // Mark that an update is available (for blob URL mode)
  // Instead of auto-reloading (which causes visual glitches), we show an "Updated" button
  function markUpdateAvailable() {
    if (!usingBlobUrl) return;
    hasUpdate = true;
    lastDataReceivedTime = Date.now();
    console.log('[MediaPlayer] Update available for blob URL mode');
  }

  // Reload blob URL when user clicks "Updated" button
  async function reloadBlobUrl() {
    if (!usingBlobUrl || !mediaRef) return;

    hasUpdate = false;
    loading = true;

    try {
      const tree = getTree();
      const chunks: Uint8Array[] = [];

      for await (const chunk of tree.readFileStream(cid, { prefetch: 5 })) {
        chunks.push(chunk);
      }

      if (chunks.length === 0) {
        loading = false;
        return;
      }

      bytesLoaded = chunks.reduce((sum, c) => sum + c.length, 0);
      lastDataReceivedTime = Date.now();

      const mimeType = getMimeType(fileName).split(';')[0];
      const blob = new Blob(chunks, { type: mimeType });
      const newBlobUrl = URL.createObjectURL(blob);

      // Store old URL to revoke after switch
      const oldUrl = mediaRef.src;

      mediaRef.addEventListener('loadedmetadata', () => {
        if (mediaRef) {
          duration = mediaRef.duration;
          // Seek near end for live streams
          if (shouldTreatAsLive && isFinite(duration) && duration > 5) {
            mediaRef.currentTime = Math.max(0, duration - 3);
          }
          mediaRef.play().catch(() => {});
        }
        loading = false;
      }, { once: true });

      mediaRef.src = newBlobUrl;

      // Revoke old URL after a delay
      if (oldUrl && oldUrl.startsWith('blob:')) {
        setTimeout(() => URL.revokeObjectURL(oldUrl), 1000);
      }

    } catch (e) {
      console.error('[MediaPlayer] Error reloading blob URL:', e);
      loading = false;
    }
  }

  // Fetch and append only new data when CID changes (MSE mode)
  // Called by the CID change effect - lastCidHash is already updated by the caller
  async function fetchNewData() {
    // Always update lastDataReceivedTime when CID changes - we know new data exists
    lastDataReceivedTime = Date.now();

    if (!sourceBuffer || !mediaSource || mediaSource.readyState !== 'open') {
      console.log('[MediaPlayer] fetchNewData: MSE not ready, state:', mediaSource?.readyState, 'sourceBuffer:', !!sourceBuffer);
      return;
    }

    try {
      const tree = getTree();

      // Fetch only bytes from our current offset onwards
      const newData = await tree.readFileRange(cid, bytesLoaded);

      if (newData && newData.length > 0) {
        await appendToSourceBuffer(newData);
        bytesLoaded += newData.length;
        console.log('[MediaPlayer] MSE appended', newData.length, 'bytes, total:', bytesLoaded);

        // Auto-detect live stream: if CID updates with new data, treat as live
        if (!isLive) {
          console.log('[MediaPlayer] Auto-detected live stream from CID update');
          isLive = true;
          startLivePolling();
        }

        // Update duration
        if (mediaRef && !isNaN(mediaRef.duration) && isFinite(mediaRef.duration)) {
          duration = mediaRef.duration;
        }
      }
    } catch (e) {
      console.error('[MediaPlayer] fetchNewData error:', e);
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

    // For blob URL mode, check if CID changed and mark update available
    if (usingBlobUrl) {
      const currentCidHash = toHex(cid.hash);
      if (currentCidHash !== lastCidHash) {
        lastCidHash = currentCidHash;
        markUpdateAvailable();
      }
      return;
    }

    // MSE mode - try to fetch new data
    if (!sourceBuffer || !mediaSource || mediaSource.readyState !== 'open') {
      // MSE not ready yet, but don't give up - keep polling
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
        console.log('[MediaPlayer] Poll: appended', newData.length, 'bytes, total:', bytesLoaded);

        // Update duration
        if (mediaRef && !isNaN(mediaRef.duration) && isFinite(mediaRef.duration)) {
          duration = mediaRef.duration;
        }

        // Update last CID hash to track that we've processed this version
        lastCidHash = currentCidHash;
      } else if (currentCidHash !== lastCidHash) {
        // CID changed but no new data yet - still consider stream active
        lastDataReceivedTime = Date.now();
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

  // Watch for CID changes - handles both live streams and file updates
  // Access cid.hash directly to ensure reactivity
  let currentCidHashReactive = $derived(cid?.hash ? toHex(cid.hash) : null);

  $effect(() => {
    if (loading) return;

    const currentCidHash = currentCidHashReactive;
    if (currentCidHash && currentCidHash !== lastCidHash) {
      // Update lastCidHash immediately to prevent effect from re-triggering
      lastCidHash = currentCidHash;

      // For MSE mode (WebM), append new data incrementally - smooth live streaming
      // For blob URL mode, show "Updated" button instead of auto-reloading
      if (usingBlobUrl) {
        markUpdateAvailable();
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

    <!-- Updated button (blob URL mode only) - shown when file has been updated -->
    {#if hasUpdate && !loading && !error}
      <button
        type="button"
        onclick={reloadBlobUrl}
        class="absolute top-3 right-3 z-10 flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded shadow-lg transition-colors"
      >
        <span class="i-lucide-refresh-cw w-4 h-4"></span>
        Updated
      </button>
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
          {formatTime(currentTime)} / {#if isFinite(duration) && duration > 0}{formatTime(duration)}{:else}<span class="text-gray-400">{bytesLoaded < 1024 * 1024 ? `${Math.round(bytesLoaded / 1024)}KB` : `${(bytesLoaded / (1024 * 1024)).toFixed(1)}MB`}</span>{/if}
          {#if shouldTreatAsLive}
            <span class="ml-2 text-xs text-gray-400">streaming</span>
          {/if}
        </div>
      {/if}
    {/if}
  </div>
</div>
