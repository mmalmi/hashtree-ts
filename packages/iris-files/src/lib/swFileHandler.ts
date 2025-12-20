/**
 * Service Worker File Request Handler
 *
 * Listens for file requests from the service worker and responds with data
 * streamed from the hashtree worker.
 *
 * Based on WebTorrent's BrowserServer pattern:
 * - SW posts requests via MessageChannel
 * - Main thread responds with headers, then streams chunks
 * - Uses pull-based streaming (SW requests each chunk)
 */

import { getTree } from '../store';
import { getLocalRootCache, getLocalRootKey, requestTreeRootFromOtherTabs } from '../treeRootCache';
import { getTreeRootSync, waitForTreeRoot } from '../stores/treeRoot';
import { nhashDecode, type CID } from 'hashtree';

interface FileRequest {
  type: 'hashtree-file';
  requestId: string;
  npub?: string;
  nhash?: string;
  treeName?: string;
  path: string;
  start: number;
  end?: number;
  mimeType: string;
  download?: boolean;
}

interface FileResponseHeaders {
  status: number;
  headers: Record<string, string>;
  body: 'STREAM' | string | null;
  totalSize?: number;
}

let isSetup = false;

/**
 * Cache for resolved CIDs to ensure consistent data across range requests.
 * Key format: "npub/treeName/path?_t=timestamp" or "nhash/path?_t=timestamp"
 * This ensures all range requests for a given video session use the same CID.
 */
const cidCache = new Map<string, { cid: CID; totalSize: number; expires: number }>();
const CID_CACHE_TTL = 60000; // 1 minute TTL

function getCacheKey(request: FileRequest): string {
  if (request.nhash) {
    return `nhash:${request.nhash}/${request.path || ''}`;
  }
  if (request.npub && request.treeName) {
    return `npub:${request.npub}/${request.treeName}/${request.path || ''}`;
  }
  return '';
}

/**
 * Clear the CID cache for a specific path
 * Call this before reloading a video to get fresh content
 */
export function clearCidCacheForPath(npub: string, treeName: string, path: string): void {
  const key = `npub:${npub}/${treeName}/${path}`;
  cidCache.delete(key);
}

/**
 * Setup the file request handler
 * Call this once at app startup
 */
export function setupSwFileHandler(): void {
  if (isSetup) return;
  if (!('serviceWorker' in navigator)) {
    console.warn('[SwFileHandler] Service workers not supported');
    return;
  }

  navigator.serviceWorker.addEventListener('message', handleSwMessage);
  isSetup = true;
  console.log('[SwFileHandler] Handler registered');
}

/**
 * Handle incoming messages from service worker
 */
function handleSwMessage(event: MessageEvent): void {
  const data = event.data as FileRequest;

  // Only handle hashtree-file requests
  if (data?.type !== 'hashtree-file') return;

  const [port] = event.ports;
  if (!port) {
    console.error('[SwFileHandler] No port in message');
    return;
  }

  handleFileRequest(data, port).catch((error) => {
    console.error('[SwFileHandler] Error handling request:', error);
    port.postMessage({
      status: 500,
      headers: { 'Content-Type': 'text/plain' },
      body: `Error: ${error.message}`,
    } as FileResponseHeaders);
  });
}

/**
 * Handle a file request from the service worker
 */
async function handleFileRequest(request: FileRequest, port: MessagePort): Promise<void> {
  try {
    const { npub, nhash, treeName, path, start, end, mimeType, download } = request;

    // Check CID cache for consistent data across range requests
    // For range requests (start > 0), use cached CID to ensure consistent video data
    // For initial requests (start === 0), fetch fresh tree root
    const cacheKey = getCacheKey(request);
    const isRangeRequest = start !== undefined && start > 0;

    if (cacheKey && isRangeRequest) {
      const cached = cidCache.get(cacheKey);
      if (cached && cached.expires > Date.now()) {
        // Use cached CID for range request
        const { cid, totalSize } = cached;
        await streamFromCid(request, port, cid, totalSize);
        return;
      }
    }

    // Resolve the CID
    let cid: CID | null = null;

    if (nhash) {
      // Direct nhash request - decode to CID
      const rootCid = nhashDecode(nhash);
      const tree = getTree();

      // If path provided AND it contains a slash, navigate within the nhash directory
      // Single filename without slashes is just a hint for MIME type - use rootCid directly
      if (path && path.includes('/')) {
        const entry = await tree.resolvePath(rootCid, path);
        if (!entry) {
          port.postMessage({
            status: 404,
            headers: { 'Content-Type': 'text/plain' },
            body: `File not found: ${path}`,
          } as FileResponseHeaders);
          return;
        }
        cid = entry.cid;
      } else {
        // Path is either empty or just a filename hint - use rootCid directly
        // Check if rootCid is a directory and path is a single filename
        if (path && !path.includes('/')) {
          // Try to resolve as file within directory first
          const entry = await tree.resolvePath(rootCid, path);
          if (entry) {
            cid = entry.cid;
          } else {
            // Not a directory with this file - use rootCid directly as file CID
            cid = rootCid;
          }
        } else {
          cid = rootCid;
        }
      }
    } else if (npub && treeName) {
      // Npub-based request - resolve through tree root cache
      const filePath = path;

      // Try local write cache first, then subscription cache, then wait for resolver
      let rootCid: CID | null = null;

      const localHash = getLocalRootCache(npub, treeName);
      if (localHash) {
        // This tab has the local write cache - we're probably the broadcaster
        const localKey = getLocalRootKey(npub, treeName);
        rootCid = { hash: localHash, key: localKey };
      } else {
        // We don't have the local write cache - request from other tabs via BroadcastChannel
        // This is critical for live streaming where the broadcaster tab has the latest data
        requestTreeRootFromOtherTabs(npub, treeName);

        // Wait for BroadcastChannel response AND give broadcaster tab time to respond to SW
        // The broadcaster tab has localRootCache so it responds to SW immediately.
        // By waiting here, we ensure the broadcaster's SW response arrives first.
        // 500ms should be plenty for the broadcaster to send its response.
        await new Promise(resolve => setTimeout(resolve, 500));

        // Check local cache again after the request (response may have arrived)
        const localHashAfterRequest = getLocalRootCache(npub, treeName);
        if (localHashAfterRequest) {
          const localKey = getLocalRootKey(npub, treeName);
          rootCid = { hash: localHashAfterRequest, key: localKey };
        } else {
          // Try sync cache (for already-resolved trees from Nostr)
          rootCid = getTreeRootSync(npub, treeName);

          // If not in cache, wait for resolver to fetch from network
          if (!rootCid) {
            rootCid = await waitForTreeRoot(npub, treeName, 30000);
          }
        }
      }

      if (!rootCid) {
        port.postMessage({
          status: 404,
          headers: { 'Content-Type': 'text/plain' },
          body: 'Tree not found',
        } as FileResponseHeaders);
        return;
      }

      // Navigate to file
      const tree = getTree();
      const entry = await tree.resolvePath(rootCid, filePath || '');
      if (!entry) {
        port.postMessage({
          status: 404,
          headers: { 'Content-Type': 'text/plain' },
          body: 'File not found',
        } as FileResponseHeaders);
        return;
      }

      cid = entry.cid;
    }

    if (!cid) {
      port.postMessage({
        status: 400,
        headers: { 'Content-Type': 'text/plain' },
        body: 'Invalid request',
      } as FileResponseHeaders);
      return;
    }

    const tree = getTree();

    // Get file size first (needed for Content-Length and range calculations)
    // Use getTreeNode which handles encryption, then sum link sizes
    let totalSize: number;
    const treeNode = await tree.getTreeNode(cid);

    if (treeNode) {
      // Chunked file - sum link sizes from decrypted tree node
      // Note: for encrypted files, link.size is the decrypted (plaintext) size
      totalSize = treeNode.links.reduce((sum, l) => sum + l.size, 0);
    } else {
      // Single blob - fetch just to check existence and get encrypted size
      const blob = await tree.getBlob(cid.hash);
      if (!blob) {
        port.postMessage({
          status: 404,
          headers: { 'Content-Type': 'text/plain' },
          body: 'File data not found',
        } as FileResponseHeaders);
        return;
      }
      // For encrypted blobs, decrypted size = encrypted size - 16 (nonce overhead)
      // This is a small file anyway (< chunk size ~2MB)
      totalSize = cid.key ? Math.max(0, blob.length - 16) : blob.length;
    }

    // Cache the resolved CID for consistent range requests
    if (cacheKey) {
      cidCache.set(cacheKey, {
        cid,
        totalSize,
        expires: Date.now() + CID_CACHE_TTL,
      });
    }

    // Stream the content
    await streamFromCid(request, port, cid, totalSize);
  } catch (error) {
    console.error('[SwFileHandler] Error:', error);
    port.postMessage({
      status: 500,
      headers: { 'Content-Type': 'text/plain' },
      body: `Error: ${(error as Error).message}`,
    } as FileResponseHeaders);
  }
}

/**
 * Stream content from a resolved CID
 */
async function streamFromCid(
  request: FileRequest,
  port: MessagePort,
  cid: CID,
  totalSize: number
): Promise<void> {
  const { npub, path, start, end, mimeType, download } = request;
  const tree = getTree();

  const rangeStart = start || 0;
  const rangeEnd = end !== undefined ? Math.min(end, totalSize - 1) : totalSize - 1;
  const contentLength = rangeEnd - rangeStart + 1;

  // Build response headers
  // For npub-based requests (mutable content), use short cache or no-cache
  // For nhash-based requests (content-addressed, immutable), use long cache
  const isNpubRequest = !!npub;
  const cacheControl = isNpubRequest
    ? 'no-cache, no-store, must-revalidate' // Mutable: always revalidate
    : 'public, max-age=31536000, immutable'; // Immutable: cache forever
  const headers: Record<string, string> = {
    'Content-Type': mimeType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': cacheControl,
  };

  // Add Content-Disposition header for downloads
  if (download) {
    const filename = path || 'file';
    headers['Content-Disposition'] = `attachment; filename="${filename}"`;
  }

  // Safari requires 206 Partial Content for ANY range request, not just start > 0
  // If end is specified (even bytes=0-1), it's a range request
  let status = 200;
  const isRangeRequest = end !== undefined || (start !== undefined && start > 0);
  if (isRangeRequest) {
    status = 206;
    headers['Content-Range'] = `bytes ${rangeStart}-${rangeEnd}/${totalSize}`;
  }
  headers['Content-Length'] = String(contentLength);

  // Send headers first
  port.postMessage({
    status,
    headers,
    body: 'STREAM',
    totalSize,
  } as FileResponseHeaders);

  // Stream chunks via pull-based protocol using readFileRange
  // This fetches only the needed chunks from network, not the whole file
  let offset = rangeStart;
  const CHUNK_SIZE = 512 * 1024; // 512KB chunks for efficient network fetches

  port.onmessage = async (msg: MessageEvent) => {
    if (msg.data === false) {
      // Cancel signal
      port.onmessage = null;
      return;
    }

    if (msg.data === true) {
      // Pull request - fetch and send next chunk
      if (offset > rangeEnd) {
        // Done
        port.postMessage(null);
        port.onmessage = null;
        return;
      }

      try {
        const chunkEnd = Math.min(offset + CHUNK_SIZE - 1, rangeEnd);
        const chunk = await tree.readFileRange(cid, offset, chunkEnd + 1);
        if (chunk) {
          port.postMessage(chunk);
          offset = chunkEnd + 1;
        } else {
          port.postMessage(null);
          port.onmessage = null;
        }
      } catch (err) {
        console.error('[SwFileHandler] Range read error:', err);
        port.postMessage(null);
        port.onmessage = null;
      }
    }
  };
}
