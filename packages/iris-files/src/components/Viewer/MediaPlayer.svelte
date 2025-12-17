<script lang="ts">
  /**
   * MediaPlayer - On-demand streaming media player for video and audio
   *
   * Primary mode: Service Worker streaming via npub URL
   * - Uses /{npub}/{treeName}/{path} URLs intercepted by service worker
   * - Service worker streams data from hashtree worker
   * - Supports live streaming (worker watches for tree root updates)
   * - Browser handles seeking, buffering, range requests natively
   *
   * Fallback mode: MSE with direct fetching
   * - Used when service worker not available or npub context missing
   * - Uses MediaSource Extensions with on-demand range fetching
   */
  import { getTree } from '../../store';
  import { recentlyChangedFiles } from '../../stores/recentlyChanged';
  import { currentHash } from '../../stores';
  import { toHex, type CID } from 'hashtree';
  import { getCidFileUrl, getNpubFileUrl } from '../../lib/mediaUrl';
  import { isMediaStreamingSetup, setupMediaStreaming } from '../../lib/mediaStreamingSetup';

  interface Props {
    cid: CID;
    fileName: string;
    fileSize?: number;
    /** Media type: 'video' or 'audio' */
    type?: 'video' | 'audio';
    /** Npub for live streaming support (optional) */
    npub?: string;
    /** Tree name for live streaming support (optional) */
    treeName?: string;
    /** Full path within tree for live streaming support (optional) */
    path?: string;
  }

  let props: Props = $props();
  // Derive from props to ensure reactivity
  let cid = $derived(props.cid);
  let fileName = $derived(props.fileName);
  let fileSize = $derived(props.fileSize ?? 0);
  let mediaType = $derived(props.type ?? 'video');
  let isAudio = $derived(mediaType === 'audio');
  // Npub context for live streaming
  let npub = $derived(props.npub);
  let treeName = $derived(props.treeName);
  let filePath = $derived(props.path);

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

  // Service worker streaming mode
  let usingSWStreaming = $state(false);

  // Track bytes loaded for incremental fetching
  let bytesLoaded = $state(0);
  let lastCidHash = $state<string | null>(null);

  // Abort controller for cancelling fetches on unmount
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

          isFullyLoaded = true;
          isLive = false;
        }
      }, 2000);
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
      // WebM - use flexible codec string for MSE
      'webm': 'video/webm;codecs=vp8,opus',
      // MP4 - use flexible codec string that works for most h264/aac content
      'mp4': 'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'm4v': 'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'ogg': 'video/ogg;codecs=theora,vorbis',
      'ogv': 'video/ogg;codecs=theora,vorbis',
      // Audio
      'mp3': 'audio/mpeg',
      'wav': 'audio/wav',
      'flac': 'audio/flac',
      'm4a': 'audio/mp4;codecs=mp4a.40.2',
      'aac': 'audio/aac',
      'oga': 'audio/ogg;codecs=vorbis',
    };
    return mimeTypes[ext] || (isAudio ? 'audio/mpeg' : 'video/mp4;codecs=avc1.42E01E,mp4a.40.2');
  }

  // Check if MSE is supported for this mime type
  function isMseSupported(mimeType: string): boolean {
    if (!('MediaSource' in window)) return false;
    // Try exact match first
    if (MediaSource.isTypeSupported(mimeType)) return true;
    // Try base type without codecs
    const baseType = mimeType.split(';')[0];
    return MediaSource.isTypeSupported(baseType);
  }

  // Get supported MIME type (try with codecs, fall back to base)
  function getSupportedMimeType(filename: string): string | null {
    const mimeType = getMimeType(filename);
    if (MediaSource.isTypeSupported(mimeType)) return mimeType;
    const baseType = mimeType.split(';')[0];
    if (MediaSource.isTypeSupported(baseType)) return baseType;
    return null;
  }

  // Append data to source buffer, waiting for it to be ready
  async function appendToSourceBuffer(data: Uint8Array): Promise<boolean> {
    if (!sourceBuffer || !mediaSource || mediaSource.readyState !== 'open') {
      return false;
    }

    // Wait for buffer to be ready (with timeout)
    let waitCount = 0;
    while (sourceBuffer.updating) {
      await new Promise(r => setTimeout(r, 10));
      waitCount++;
      if (waitCount > 100) {
        console.warn('[MediaPlayer] Timeout waiting for sourceBuffer');
        return false;
      }
    }

    try {
      sourceBuffer.appendBuffer(data);

      // Wait for append to complete
      await new Promise<void>((resolve, reject) => {
        if (!sourceBuffer!.updating) {
          resolve();
        } else {
          const onUpdate = () => {
            sourceBuffer!.removeEventListener('updateend', onUpdate);
            sourceBuffer!.removeEventListener('error', onError);
            resolve();
          };
          const onError = (e: Event) => {
            sourceBuffer!.removeEventListener('updateend', onUpdate);
            sourceBuffer!.removeEventListener('error', onError);
            reject(e);
          };
          sourceBuffer!.addEventListener('updateend', onUpdate);
          sourceBuffer!.addEventListener('error', onError);
        }
      });

      // Update buffered info
      if (sourceBuffer.buffered.length > 0) {
        bufferedEnd = sourceBuffer.buffered.end(sourceBuffer.buffered.length - 1);
      }
      return true;
    } catch (e) {
      console.error('[MediaPlayer] MSE append error:', e);
      return false;
    }
  }

  // Buffer size constants
  const INITIAL_FETCH_SIZE = 512 * 1024; // 512KB initial fetch for quick start
  const BUFFER_FETCH_SIZE = 1024 * 1024; // 1MB subsequent fetches
  const BUFFER_THRESHOLD_SECONDS = 10; // Fetch more when buffer < 10 seconds ahead
  const BUFFER_THRESHOLD_BYTES = 2 * 1024 * 1024; // Or when < 2MB buffered ahead

  // Track if we've loaded all data
  let isFullyLoaded = $state(false);
  let isFetching = $state(false);

  // Track pending seek - when user seeks, we need to fetch that range
  let pendingSeekTime = $state<number | null>(null);

  // Fetch data starting from a specific byte offset
  async function fetchRange(start: number, size: number): Promise<Uint8Array | null> {
    if (abortController?.signal.aborted) return null;

    try {
      const tree = getTree();
      const end = start + size;
      const data = await tree.readFileRange(cid, start, end);
      return data;
    } catch (e) {
      if (!abortController?.signal.aborted) {
        console.error('[MediaPlayer] fetchRange error:', e);
      }
      return null;
    }
  }

  // Fetch more data for progressive playback
  async function fetchMoreData() {
    if (isFetching || isFullyLoaded || !sourceBuffer || !mediaSource || mediaSource.readyState !== 'open') {
      return;
    }

    // Check if we need more data based on buffer state
    if (mediaRef && sourceBuffer.buffered.length > 0) {
      const bufferedTime = sourceBuffer.buffered.end(sourceBuffer.buffered.length - 1);
      const bufferAhead = bufferedTime - mediaRef.currentTime;

      // Calculate bytes buffered ahead (rough estimate)
      const bytesBufferedAhead = fileSize > 0 && duration > 0
        ? (bufferAhead / duration) * fileSize
        : bytesLoaded;

      // Only fetch if buffer is running low
      if (bufferAhead > BUFFER_THRESHOLD_SECONDS && bytesBufferedAhead > BUFFER_THRESHOLD_BYTES && !shouldTreatAsLive) {
        return;
      }
    }

    isFetching = true;

    try {
      const data = await fetchRange(bytesLoaded, BUFFER_FETCH_SIZE);

      if (!data || data.length === 0) {
        isFullyLoaded = true;
        console.log('[MediaPlayer] Reached end of file at', bytesLoaded, 'bytes');
      } else {
        const success = await appendToSourceBuffer(data);
        if (success) {
          bytesLoaded += data.length;
          lastDataReceivedTime = Date.now();
          console.log('[MediaPlayer] Fetched', data.length, 'bytes, total:', bytesLoaded);

          // Update duration after new data
          if (mediaRef && !isNaN(mediaRef.duration) && isFinite(mediaRef.duration)) {
            duration = mediaRef.duration;
          }

          // Check if we got less than requested - means we're at the end
          if (data.length < BUFFER_FETCH_SIZE) {
            isFullyLoaded = true;
            console.log('[MediaPlayer] File fully loaded:', bytesLoaded, 'bytes');
          }
        }
      }
    } catch (e) {
      console.error('[MediaPlayer] Error fetching more data:', e);
    } finally {
      isFetching = false;
    }
  }

  // Handle seek - for now, we don't support seeking backwards in MSE without full file
  // This is a limitation we can improve later with proper segment-based seeking
  async function handleSeek() {
    if (!mediaRef || !sourceBuffer) return;

    const seekTime = mediaRef.currentTime;

    // Check if seek position is within buffered range
    for (let i = 0; i < sourceBuffer.buffered.length; i++) {
      if (seekTime >= sourceBuffer.buffered.start(i) && seekTime <= sourceBuffer.buffered.end(i)) {
        // Seek is within buffered range, nothing to do
        return;
      }
    }

    // Seek is outside buffered range - for now, just fetch more data
    // Future improvement: calculate byte offset from time and fetch that range
    console.log('[MediaPlayer] Seek to', seekTime, 'outside buffered range, fetching more data');
    if (!isFullyLoaded && !isFetching) {
      fetchMoreData();
    }
  }

  // Track if using blob URL mode (for formats MSE can't handle)
  let usingBlobUrl = false;

  // Load with service worker streaming - simplest approach, browser handles everything
  async function loadWithSWStreaming() {
    if (!cid?.hash || !mediaRef) {
      error = 'No file CID or media element';
      loading = false;
      return;
    }

    // Ensure media streaming is set up
    const isSetup = isMediaStreamingSetup() || await setupMediaStreaming();
    if (!isSetup) {
      console.log('[MediaPlayer] SW streaming not available, falling back to MSE');
      return false;
    }

    // Use npub-based URL if we have the context (supports live streaming)
    // Otherwise fall back to CID-based URL
    let url: string;
    if (npub && treeName && filePath) {
      url = getNpubFileUrl(npub, treeName, filePath);
      console.log('[MediaPlayer] Using npub SW streaming (live-capable):', url);
    } else {
      url = getCidFileUrl(cid, fileName);
      console.log('[MediaPlayer] Using CID SW streaming:', url);
    }

    usingSWStreaming = true;
    mediaRef.src = url;

    // Listen for events
    mediaRef.addEventListener('loadedmetadata', () => {
      if (mediaRef && !isNaN(mediaRef.duration) && isFinite(mediaRef.duration)) {
        duration = mediaRef.duration;
        console.log('[MediaPlayer] Duration from SW streaming:', duration);
      }
    }, { once: true });

    mediaRef.addEventListener('canplay', () => {
      loading = false;
      console.log('[MediaPlayer] SW streaming ready to play');
    }, { once: true });

    mediaRef.addEventListener('error', (e) => {
      console.error('[MediaPlayer] SW streaming error:', e);
      // Could fall back to MSE here, but for now just show error
      error = 'Failed to load media';
      loading = false;
    }, { once: true });

    // Try to start playback
    try {
      await mediaRef.play();
    } catch (e) {
      console.log('[MediaPlayer] Autoplay blocked:', (e as Error).message);
    }

    return true;
  }

  // Load media - try SW streaming first, then MSE, then blob URL
  async function loadMedia() {
    if (!cid?.hash) {
      error = 'No file CID';
      loading = false;
      return;
    }

    // Try service worker streaming first (simplest, best seeking support)
    // Skip for live streams which need MSE for dynamic content appending
    if (!shouldTreatAsLive && mediaRef) {
      const success = await loadWithSWStreaming();
      if (success) return;
    }

    // Fall back to MSE for live streams or when SW streaming fails
    const mimeType = getSupportedMimeType(fileName);

    if (!mimeType) {
      // No MSE support for this format - try blob URL directly
      console.log('[MediaPlayer] No MSE support, using blob URL');
      await loadWithBlobUrl();
      return;
    }

    console.log('[MediaPlayer] Trying MSE, mime:', mimeType);

    try {
      mediaSource = new MediaSource();

      if (!mediaRef) {
        return;
      }
      mediaRef.src = URL.createObjectURL(mediaSource);

      abortController = new AbortController();

      await new Promise<void>((resolve, reject) => {
        mediaSource!.addEventListener('sourceopen', () => resolve(), { once: true });
        mediaSource!.addEventListener('error', (e) => reject(e), { once: true });
      });

      if (abortController.signal.aborted) return;

      sourceBuffer = mediaSource.addSourceBuffer(mimeType);
      console.log('[MediaPlayer] MSE source buffer created for', mimeType);

      // Listen for duration to become available
      if (mediaRef) {
        mediaRef.addEventListener('loadedmetadata', () => {
          if (mediaRef && !isNaN(mediaRef.duration) && isFinite(mediaRef.duration)) {
            duration = mediaRef.duration;
            console.log('[MediaPlayer] Duration from metadata:', duration);
          }
        }, { once: true });
      }

      // Fetch initial data - enough to start playback
      console.log('[MediaPlayer] Fetching initial', INITIAL_FETCH_SIZE, 'bytes');
      const initialData = await fetchRange(0, INITIAL_FETCH_SIZE);

      if (abortController.signal.aborted) return;

      if (!initialData || initialData.length === 0) {
        error = 'Failed to load media data';
        loading = false;
        return;
      }

      const success = await appendToSourceBuffer(initialData);
      if (!success) {
        // MSE append failed - likely non-fragmented MP4
        // Fall back to blob URL which browser's native player can handle
        console.log('[MediaPlayer] MSE append failed, falling back to blob URL');
        cleanupMse();
        await loadWithBlobUrl();
        return;
      }

      bytesLoaded = initialData.length;
      lastCidHash = toHex(cid.hash);
      lastDataReceivedTime = Date.now();

      // Check if we got the whole file
      if (fileSize > 0 && bytesLoaded >= fileSize) {
        isFullyLoaded = true;
      } else if (initialData.length < INITIAL_FETCH_SIZE) {
        isFullyLoaded = true;
      }

      loading = false;
      console.log('[MediaPlayer] Initial MSE load complete, loaded:', bytesLoaded, 'bytes, fully loaded:', isFullyLoaded);

      // Try to start playback
      if (mediaRef) {
        mediaRef.play().catch((e) => {
          console.log('[MediaPlayer] Autoplay blocked:', e.message);
        });
      }

      // Update duration after initial data
      if (mediaRef && !isNaN(mediaRef.duration) && isFinite(mediaRef.duration)) {
        duration = mediaRef.duration;
      }

      // For live streams, seek near end and start polling
      if (shouldTreatAsLive && mediaRef && isFinite(duration) && duration > 5) {
        mediaRef.currentTime = Math.max(0, duration - 5);
        isLive = true;
        startLivePolling();
      }

    } catch (e) {
      console.error('[MediaPlayer] MSE load failed:', e);
      // Try blob URL as fallback
      cleanupMse();
      await loadWithBlobUrl();
    }
  }

  // Cleanup MSE state
  function cleanupMse() {
    if (mediaSource && mediaSource.readyState === 'open') {
      try {
        mediaSource.endOfStream();
      } catch {
        // Ignore
      }
    }
    if (mediaRef?.src && mediaRef.src.startsWith('blob:')) {
      URL.revokeObjectURL(mediaRef.src);
    }
    mediaSource = null;
    sourceBuffer = null;
    bytesLoaded = 0;
  }

  // Load with blob URL - for formats MSE can't handle (non-fragmented MP4, MOV, etc.)
  // This requires loading the full file, but browser's native player handles seeking
  async function loadWithBlobUrl() {
    usingBlobUrl = true;
    console.log('[MediaPlayer] Loading with blob URL (native player)');

    try {
      const tree = getTree();
      const chunks: Uint8Array[] = [];
      let loaded = 0;

      // Stream chunks with progress
      for await (const chunk of tree.readFileStream(cid, { prefetch: 5 })) {
        if (abortController?.signal.aborted) return;
        chunks.push(chunk);
        loaded += chunk.length;
        bytesLoaded = loaded;
      }

      if (chunks.length === 0) {
        error = 'Failed to load media';
        loading = false;
        return;
      }

      lastCidHash = toHex(cid.hash);
      lastDataReceivedTime = Date.now();
      isFullyLoaded = true;

      const mimeType = getMimeType(fileName).split(';')[0];
      const blob = new Blob(chunks, { type: mimeType });

      if (mediaRef) {
        mediaRef.src = URL.createObjectURL(blob);

        mediaRef.addEventListener('loadedmetadata', () => {
          if (mediaRef && !isNaN(mediaRef.duration) && isFinite(mediaRef.duration)) {
            duration = mediaRef.duration;
            console.log('[MediaPlayer] Blob URL duration:', duration);
          }
        }, { once: true });
      }

      loading = false;
      console.log('[MediaPlayer] Blob URL load complete:', bytesLoaded, 'bytes');

      // Try to start playback
      if (mediaRef) {
        mediaRef.play().catch((e) => {
          console.log('[MediaPlayer] Autoplay blocked:', e.message);
        });
      }
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load media';
      loading = false;
    }
  }

  // Fetch and append only new data when CID changes (live streaming)
  async function fetchNewData() {
    lastDataReceivedTime = Date.now();

    if (!sourceBuffer || !mediaSource || mediaSource.readyState !== 'open') {
      return;
    }

    try {
      const tree = getTree();
      const newData = await tree.readFileRange(cid, bytesLoaded);

      if (newData && newData.length > 0) {
        await appendToSourceBuffer(newData);
        bytesLoaded += newData.length;
        console.log('[MediaPlayer] Live: appended', newData.length, 'bytes, total:', bytesLoaded);

        if (!isLive) {
          console.log('[MediaPlayer] Auto-detected live stream from CID update');
          isLive = true;
          startLivePolling();
        }

        if (mediaRef && !isNaN(mediaRef.duration) && isFinite(mediaRef.duration)) {
          duration = mediaRef.duration;
        }
      }
    } catch (e) {
      console.error('[MediaPlayer] fetchNewData error:', e);
    }
  }

  // Track if we're currently polling
  let isPolling = false;

  // Poll for new data (live streams)
  async function pollForNewData() {
    if (isPolling || !shouldTreatAsLive || loading) return;

    if (!sourceBuffer || !mediaSource || mediaSource.readyState !== 'open') {
      return;
    }

    isPolling = true;

    try {
      const tree = getTree();
      const currentCidHash = toHex(cid.hash);
      const newData = await tree.readFileRange(cid, bytesLoaded);

      if (newData && newData.length > 0) {
        await appendToSourceBuffer(newData);
        bytesLoaded += newData.length;
        lastDataReceivedTime = Date.now();
        console.log('[MediaPlayer] Poll: appended', newData.length, 'bytes');

        if (mediaRef && !isNaN(mediaRef.duration) && isFinite(mediaRef.duration)) {
          duration = mediaRef.duration;
        }
        lastCidHash = currentCidHash;
      } else if (currentCidHash !== lastCidHash) {
        lastDataReceivedTime = Date.now();
        lastCidHash = currentCidHash;
      }
    } catch {
      // Silently ignore polling errors
    } finally {
      isPolling = false;
    }
  }

  function startLivePolling() {
    if (livePollingInterval) {
      clearInterval(livePollingInterval);
    }
    livePollingInterval = setInterval(() => pollForNewData(), LIVE_POLL_INTERVAL);
  }

  function stopLivePolling() {
    if (livePollingInterval) {
      clearInterval(livePollingInterval);
      livePollingInterval = null;
    }
  }

  // Watch for CID changes
  let currentCidHashReactive = $derived(cid?.hash ? toHex(cid.hash) : null);

  $effect(() => {
    if (loading) return;

    const currentCidHash = currentCidHashReactive;
    if (currentCidHash && currentCidHash !== lastCidHash) {
      lastCidHash = currentCidHash;
      fetchNewData();
    }
  });

  // Update current time and check buffer
  function handleTimeUpdate() {
    if (mediaRef) {
      currentTime = mediaRef.currentTime;

      // Check if we need to fetch more data
      if (!isFullyLoaded && !isFetching) {
        fetchMoreData();
      }
    }
  }

  function handlePlay() {
    paused = false;
  }

  function handlePause() {
    paused = true;
  }

  // Handle video waiting (stalled due to buffering)
  function handleWaiting() {
    console.log('[MediaPlayer] Buffering...');
    if (!isFullyLoaded && !isFetching) {
      fetchMoreData();
    }
    if (shouldTreatAsLive && !isPolling) {
      pollForNewData();
    }
  }

  function togglePlay() {
    if (!mediaRef) return;
    if (mediaRef.paused) {
      mediaRef.play();
    } else {
      mediaRef.pause();
    }
  }

  function handleDurationChange() {
    if (mediaRef && !isNaN(mediaRef.duration) && isFinite(mediaRef.duration)) {
      duration = mediaRef.duration;
    }
  }

  function formatTime(seconds: number): string {
    if (!isFinite(seconds)) return '--:--';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  // Cleanup
  $effect(() => {
    return () => {
      stopLivePolling();

      if (abortController) {
        abortController.abort();
        abortController = null;
      }
      if (mediaSource && mediaSource.readyState === 'open') {
        try {
          mediaSource.endOfStream();
        } catch {
          // Ignore
        }
      }
      // Only revoke blob URLs, not SW streaming URLs
      if (mediaRef?.src && mediaRef.src.startsWith('blob:')) {
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
          onseeked={handleSeek}
        >
          Your browser does not support the audio tag.
        </audio>
      </div>
    {:else}
      <!-- Video element -->
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
        onseeked={handleSeek}
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
