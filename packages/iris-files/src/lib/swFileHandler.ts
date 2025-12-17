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
import { getLocalRootCache, getLocalRootKey } from '../treeRootCache';
import { getTreeRootSync } from '../stores/treeRoot';
import { fromHex, toHex, type CID } from 'hashtree';

interface FileRequest {
  type: 'hashtree-file';
  requestId: string;
  npub?: string;
  cidHex?: string;
  path: string;
  start: number;
  end?: number;
  mimeType: string;
}

interface FileResponseHeaders {
  status: number;
  headers: Record<string, string>;
  body: 'STREAM' | string | null;
  totalSize?: number;
}

let isSetup = false;

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
  const { npub, cidHex, path, start, end, mimeType } = request;

  console.log('[SwFileHandler] File request:', { npub, cidHex, path, start, end });

  try {
    // Resolve the CID
    let cid: CID | null = null;

    if (cidHex) {
      // Direct CID request
      cid = { hash: fromHex(cidHex) };
    } else if (npub && path) {
      // Npub-based request - resolve through tree root cache
      const [treeName, ...pathParts] = path.split('/');
      const filePath = pathParts.join('/');

      // Try local write cache first, then subscription cache
      let rootCid: CID | null = null;

      const localHash = getLocalRootCache(npub, treeName);
      if (localHash) {
        const localKey = getLocalRootKey(npub, treeName);
        rootCid = { hash: localHash, key: localKey };
      } else {
        // Fall back to subscription cache (for viewing others' trees)
        rootCid = getTreeRootSync(npub, treeName);
      }

      if (!rootCid) {
        console.error('[SwFileHandler] Tree not found:', npub, treeName);
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

    // Read file data
    const tree = getTree();
    const fileData = await tree.readFile(cid);

    if (!fileData) {
      port.postMessage({
        status: 404,
        headers: { 'Content-Type': 'text/plain' },
        body: 'File data not found',
      } as FileResponseHeaders);
      return;
    }

    const totalSize = fileData.length;
    const rangeStart = start || 0;
    const rangeEnd = end !== undefined ? Math.min(end, totalSize - 1) : totalSize - 1;
    const contentLength = rangeEnd - rangeStart + 1;

    // Build response headers
    const headers: Record<string, string> = {
      'Content-Type': mimeType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=31536000, immutable',
    };

    let status = 200;
    if (start !== undefined && start > 0) {
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

    // Stream chunks via pull-based protocol
    let offset = rangeStart;
    const CHUNK_SIZE = 64 * 1024; // 64KB chunks

    port.onmessage = (msg: MessageEvent) => {
      if (msg.data === false) {
        // Cancel signal
        port.onmessage = null;
        return;
      }

      if (msg.data === true) {
        // Pull request - send next chunk
        if (offset > rangeEnd) {
          // Done
          port.postMessage(null);
          port.onmessage = null;
          return;
        }

        const chunkEnd = Math.min(offset + CHUNK_SIZE - 1, rangeEnd);
        const chunk = fileData.slice(offset, chunkEnd + 1);
        port.postMessage(chunk);
        offset = chunkEnd + 1;
      }
    };
  } catch (error) {
    console.error('[SwFileHandler] Error:', error);
    port.postMessage({
      status: 500,
      headers: { 'Content-Type': 'text/plain' },
      body: `Error: ${(error as Error).message}`,
    } as FileResponseHeaders);
  }
}
