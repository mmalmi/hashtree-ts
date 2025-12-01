import { useRef, useEffect, useState, memo } from 'react';
import { getTree } from '../store';
import { getRefResolver } from '../refResolver';
import type { Hash } from 'hashtree';
import { toHex } from 'hashtree';

// Persist video settings in memory
const videoSettings = {
  muted: false,
  volume: 1,
};

interface LiveVideoProps {
  /** Resolver key (npub/treename) for subscribing to root hash updates */
  resolverKey: string | null;
  /** Path within the tree to the video file */
  filePath: string[];
  /** Video mime type */
  mimeType: string;
  /** Initial hash (used if no pointerKey or for immediate display) */
  initialHash?: Hash;
}

/**
 * Video player that streams directly from merkle tree.
 * Uses MediaSource API to append chunks as they're read.
 *
 * Key feature: Subscribes to pointer updates via callback, NOT React state.
 * When the merkle root changes, the callback directly appends new bytes
 * to MediaSource without triggering React re-renders.
 */
export const LiveVideo = memo(function LiveVideo({
  resolverKey,
  filePath,
  mimeType,
  initialHash,
}: LiveVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaSourceRef = useRef<MediaSource | null>(null);
  const sourceBufferRef = useRef<SourceBuffer | null>(null);
  const appendedBytesRef = useRef(0);
  const isStreamingRef = useRef(false);
  const currentHashRef = useRef<string>('');
  const [useFallback, setUseFallback] = useState(false);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const lastPositionRef = useRef(0);
  const wasPlayingRef = useRef(false);
  const filePathRef = useRef<string[]>(filePath);
  filePathRef.current = filePath;
  const useFallbackRef = useRef(useFallback);
  useFallbackRef.current = useFallback;
  const fallbackUrlRef = useRef(fallbackUrl);
  fallbackUrlRef.current = fallbackUrl;

  // Resolve file hash from tree root hash
  const resolveFileHash = async (rootHash: Hash): Promise<Hash | null> => {
    const tree = getTree();
    let currentHash = rootHash;

    // Navigate through path
    for (const segment of filePathRef.current) {
      const resolved = await tree.resolvePath(currentHash, segment);
      if (!resolved) return null;
      currentHash = resolved;
    }

    return currentHash;
  };

  // Stream chunks from merkle tree to MediaSource, skipping already-appended bytes
  const streamChunks = async (fileHash: Hash, skipBytes: number = 0) => {
    if (isStreamingRef.current) return;
    isStreamingRef.current = true;

    const tree = getTree();
    const sb = sourceBufferRef.current;
    const video = videoRef.current;

    if (!sb || !video) {
      isStreamingRef.current = false;
      return;
    }

    try {
      let bytesRead = 0;
      for await (const chunk of tree.readFileStream(fileHash)) {
        const chunkStart = bytesRead;
        const chunkEnd = bytesRead + chunk.length;
        bytesRead = chunkEnd;

        // Skip chunks entirely before our skip point
        if (chunkEnd <= skipBytes) {
          continue;
        }

        // Determine what portion of this chunk to append
        let dataToAppend: Uint8Array;
        if (chunkStart < skipBytes) {
          // Partial chunk - skip first part
          dataToAppend = chunk.slice(skipBytes - chunkStart);
        } else {
          // Full chunk
          dataToAppend = chunk;
        }

        if (dataToAppend.length === 0) continue;

        // Wait for buffer to be ready
        while (sb.updating) {
          await new Promise(r => setTimeout(r, 10));
        }

        try {
          sb.appendBuffer(new Uint8Array(dataToAppend).buffer);
          appendedBytesRef.current += dataToAppend.length;
        } catch (e) {
          console.warn('Failed to append chunk:', e);
          break;
        }

        // If video was ended/paused at end, resume
        if (video.paused && video.ended) {
          video.play().catch(() => {});
        }
      }
    } catch (e) {
      console.warn('Stream error:', e);
    }

    isStreamingRef.current = false;
  };

  // Handle hash update from pointer subscription (runs outside React render)
  const handleHashUpdate = async (rootHash: Hash | null) => {
    console.log('[LiveVideo] handleHashUpdate called', rootHash ? toHex(rootHash).slice(0, 8) : null);
    if (!rootHash) return;

    const fileHash = await resolveFileHash(rootHash);
    console.log('[LiveVideo] resolved file hash:', fileHash ? toHex(fileHash).slice(0, 8) : null);
    if (!fileHash) return;

    const hashHex = toHex(fileHash);
    if (hashHex === currentHashRef.current) {
      console.log('[LiveVideo] same file hash, skipping');
      return; // Same file hash, skip
    }

    console.log('[LiveVideo] NEW file hash:', hashHex.slice(0, 8), 'old:', currentHashRef.current.slice(0, 8));
    currentHashRef.current = hashHex;

    if (useFallbackRef.current) {
      // Fallback mode - reload blob
      const tree = getTree();
      const data = await tree.readFile(fileHash);
      if (!data) return;

      const video = videoRef.current;
      if (video) {
        lastPositionRef.current = video.currentTime;
        wasPlayingRef.current = !video.paused;
      }

      const blob = new Blob([new Uint8Array(data)], { type: mimeType });
      const url = URL.createObjectURL(blob);

      if (fallbackUrlRef.current) {
        URL.revokeObjectURL(fallbackUrlRef.current);
      }
      setFallbackUrl(url);
    } else {
      // MediaSource mode - stream only new bytes
      streamChunks(fileHash, appendedBytesRef.current);
    }
  };

  // Initialize MediaSource and subscribe to pointer updates
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Check MediaSource support
    const canUseMS = typeof MediaSource !== 'undefined' &&
      MediaSource.isTypeSupported(mimeType);

    if (!canUseMS) {
      setUseFallback(true);
    }

    // Set up MediaSource if supported
    if (canUseMS && !mediaSourceRef.current) {
      const ms = new MediaSource();
      mediaSourceRef.current = ms;
      video.src = URL.createObjectURL(ms);

      ms.addEventListener('sourceopen', async () => {
        try {
          const sb = ms.addSourceBuffer(mimeType);
          sourceBufferRef.current = sb;

          // Stream initial content
          if (initialHash) {
            const fileHash = await resolveFileHash(initialHash);
            if (fileHash) {
              currentHashRef.current = toHex(fileHash);
              streamChunks(fileHash, 0);
            }
          }
        } catch (e) {
          console.warn('MediaSource setup failed:', e);
          setUseFallback(true);
        }
      });
    }

    // Subscribe to root hash updates (runs outside React render cycle)
    let unsubscribe: (() => void) | null = null;
    if (resolverKey) {
      const resolver = getRefResolver();
      if (resolver) {
        unsubscribe = resolver.subscribe(resolverKey, handleHashUpdate);
      }
    }

    return () => {
      unsubscribe?.();
      if (video.src?.startsWith('blob:')) {
        URL.revokeObjectURL(video.src);
      }
    };
  }, [resolverKey, mimeType]); // Only re-run if key or mime changes, NOT hash

  // Fallback: load initial content when fallback mode activates
  useEffect(() => {
    if (!useFallback || !initialHash) return;

    const loadFallback = async () => {
      const fileHash = await resolveFileHash(initialHash);
      if (!fileHash) return;

      currentHashRef.current = toHex(fileHash);

      const tree = getTree();
      const data = await tree.readFile(fileHash);
      if (!data) return;

      const blob = new Blob([new Uint8Array(data)], { type: mimeType });
      const url = URL.createObjectURL(blob);
      setFallbackUrl(url);
    };

    loadFallback();

    return () => {
      if (fallbackUrl) {
        URL.revokeObjectURL(fallbackUrl);
      }
    };
  }, [useFallback, initialHash, mimeType]);

  // Restore position for fallback
  useEffect(() => {
    if (!useFallback || !fallbackUrl) return;

    const video = videoRef.current;
    if (!video) return;

    const restore = () => {
      if (lastPositionRef.current > 0) {
        video.currentTime = Math.min(lastPositionRef.current, video.duration || 0);
      }
      if (wasPlayingRef.current) {
        video.play().catch(() => {});
      }
    };

    if (video.readyState >= 1) {
      restore();
    } else {
      video.addEventListener('loadedmetadata', restore, { once: true });
    }
  }, [fallbackUrl, useFallback]);

  // Video event handlers: ended + volume persistence
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Apply saved settings
    video.muted = videoSettings.muted;
    video.volume = videoSettings.volume;

    const handleEnded = () => video.pause();
    const handleVolumeChange = () => {
      videoSettings.muted = video.muted;
      videoSettings.volume = video.volume;
    };

    video.addEventListener('ended', handleEnded);
    video.addEventListener('volumechange', handleVolumeChange);
    return () => {
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('volumechange', handleVolumeChange);
    };
  }, []);

  // Autoplay when video is ready
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleCanPlay = () => {
      video.play().catch(() => {
        video.muted = true;
        video.play().catch(() => {});
      });
    };

    video.addEventListener('canplay', handleCanPlay, { once: true });
    return () => video.removeEventListener('canplay', handleCanPlay);
  }, []);

  const src = useFallback ? fallbackUrl : undefined;
  if (useFallback && !fallbackUrl) return null;

  return (
    <video
      ref={videoRef}
      src={src ?? undefined}
      controls
      autoPlay
      muted={videoSettings.muted}
      className="w-full"
    />
  );
}, (prevProps, nextProps) => {
  // Only re-render if resolverKey, filePath, or mimeType change
  // Hash updates are handled via subscription callback, not re-renders
  return prevProps.resolverKey === nextProps.resolverKey &&
         prevProps.mimeType === nextProps.mimeType &&
         prevProps.filePath.join('/') === nextProps.filePath.join('/');
});

// Legacy component for direct hash access (no resolver subscription)
export function LiveVideoFromHash({ hash, mimeType }: { hash: Hash; mimeType: string }) {
  return (
    <LiveVideo
      resolverKey={null}
      filePath={[]}
      mimeType={mimeType}
      initialHash={hash}
    />
  );
}
