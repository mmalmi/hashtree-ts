import { useRef, useEffect, useState, memo } from 'react';
import { getTree } from '../store';
import { getRefResolver } from '../refResolver';
import type { CID } from 'hashtree';
import { toHex, cid as makeCid } from 'hashtree';

interface LiveVideoProps {
  /** Resolver key (npub/treename) for subscribing to root hash updates */
  resolverKey: string | null;
  /** Path within the tree to the video file */
  filePath: string[];
  /** Video mime type */
  mimeType: string;
  /** Initial CID (used if no resolverKey or for immediate display) */
  initialCid?: CID | null;
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
  initialCid,
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

  // Resolve file CID from tree root CID
  const resolveFileCid = async (rootCid: CID): Promise<CID | null> => {
    const tree = getTree();
    let currentCid = rootCid;

    // Navigate through path
    for (const segment of filePathRef.current) {
      const resolved = await tree.resolvePath(currentCid, segment);
      if (!resolved) return null;
      currentCid = resolved.cid;
    }

    return currentCid;
  };

  // Stream chunks from merkle tree to MediaSource, skipping already-appended bytes
  const streamChunks = async (fileCid: CID, skipBytes: number = 0) => {
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
      for await (const chunk of tree.readFileStream(fileCid)) {
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
  const handleHashUpdate = async (rootCid: CID | null) => {
    console.log('[LiveVideo] handleHashUpdate called', rootCid ? toHex(rootCid.hash).slice(0, 8) : null);
    if (!rootCid) return;

    const fileCid = await resolveFileCid(rootCid);
    console.log('[LiveVideo] resolved file cid:', fileCid ? toHex(fileCid.hash).slice(0, 8) : null);
    if (!fileCid) return;

    const hashHex = toHex(fileCid.hash);
    if (hashHex === currentHashRef.current) {
      console.log('[LiveVideo] same file hash, skipping');
      return; // Same file hash, skip
    }

    console.log('[LiveVideo] NEW file hash:', hashHex.slice(0, 8), 'old:', currentHashRef.current.slice(0, 8));
    currentHashRef.current = hashHex;

    if (useFallbackRef.current) {
      // Fallback mode - reload blob
      const tree = getTree();
      const data = await tree.readFile(fileCid);
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
      streamChunks(fileCid, appendedBytesRef.current);
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
          if (initialCid) {
            const fileCid = await resolveFileCid(initialCid);
            if (fileCid) {
              currentHashRef.current = toHex(fileCid.hash);
              streamChunks(fileCid, 0);
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
        // Wrap the callback to convert hash/encryptionKey to CID
        unsubscribe = resolver.subscribe(resolverKey, (hash, encryptionKey) => {
          if (!hash) {
            handleHashUpdate(null);
          } else {
            handleHashUpdate(makeCid(hash, encryptionKey));
          }
        });
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
    if (!useFallback || !initialCid) return;

    const loadFallback = async () => {
      const fileCid = await resolveFileCid(initialCid);
      if (!fileCid) return;

      currentHashRef.current = toHex(fileCid.hash);

      const tree = getTree();
      const data = await tree.readFile(fileCid);
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
  }, [useFallback, initialCid, mimeType]);

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

  // Video event handlers
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleEnded = () => video.pause();
    video.addEventListener('ended', handleEnded);

    return () => {
      video.removeEventListener('ended', handleEnded);
    };
  }, []);

  const src = useFallback ? fallbackUrl : undefined;
  if (useFallback && !fallbackUrl) {
    return null;
  }

  return (
    <div className="w-full h-full flex items-center justify-center">
      <video
        ref={videoRef}
        src={src ?? undefined}
        controls
        autoPlay
        className="max-w-full max-h-full object-contain"
      />
    </div>
  );
}, (prevProps, nextProps) => {
  // Only re-render if resolverKey, filePath, or mimeType change
  // Hash updates are handled via subscription callback, not re-renders
  return prevProps.resolverKey === nextProps.resolverKey &&
         prevProps.mimeType === nextProps.mimeType &&
         prevProps.filePath.join('/') === nextProps.filePath.join('/');
});

// Component for direct CID access (no resolver subscription)
export function LiveVideoFromHash({ cid, mimeType }: { cid: CID; mimeType: string }) {
  return (
    <LiveVideo
      resolverKey={null}
      filePath={[]}
      mimeType={mimeType}
      initialCid={cid}
    />
  );
}
