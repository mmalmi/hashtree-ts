/**
 * Service Worker with Media Streaming Support
 *
 * Extends VitePWA's workbox service worker with:
 * - Interception of /media/{cidHex}/{path} requests
 * - Range request support for video seeking
 * - MessageChannel communication with hashtree worker
 */

/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching';

declare let self: ServiceWorkerGlobalScope;

// Precache static assets (injected by VitePWA)
precacheAndRoute(self.__WB_MANIFEST);

// MessagePort for communicating with hashtree worker
let workerPort: MessagePort | null = null;

// Pending media requests waiting for worker responses
const pendingRequests = new Map<string, {
  resolve: (response: Response) => void;
  reject: (error: Error) => void;
  controller: ReadableStreamDefaultController<Uint8Array> | null;
  totalSize: number;
  mimeType: string;
  rangeStart: number;
  rangeEnd: number | undefined;
}>();

// Request counter for unique IDs
let requestId = 0;

/**
 * Guess MIME type from file path/extension
 */
function guessMimeType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const mimeTypes: Record<string, string> = {
    // Video
    'mp4': 'video/mp4',
    'm4v': 'video/mp4',
    'webm': 'video/webm',
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
    // Images
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'svg': 'image/svg+xml',
    // Documents
    'pdf': 'application/pdf',
    'txt': 'text/plain',
    'html': 'text/html',
    'css': 'text/css',
    'js': 'application/javascript',
    'json': 'application/json',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * Handle messages from main thread
 */
self.addEventListener('message', (event: ExtendableMessageEvent) => {
  if (event.data?.type === 'REGISTER_WORKER_PORT') {
    workerPort = event.data.port;
    setupWorkerPortHandler();
    console.log('[SW] Worker port registered');
  }

  // Respond to service worker version check
  if (event.data?.type === 'GET_VERSION') {
    event.ports[0]?.postMessage({ version: '1.0.0' });
  }
});

/**
 * Setup message handler for worker port
 */
function setupWorkerPortHandler() {
  if (!workerPort) return;

  workerPort.onmessage = (event: MessageEvent) => {
    const data = event.data;
    const reqId = data.requestId;
    const pending = pendingRequests.get(reqId);

    if (!pending) {
      console.warn('[SW] No pending request for id:', reqId);
      return;
    }

    switch (data.type) {
      case 'headers':
        // Initial response with headers - update pending state
        pending.totalSize = data.totalSize;
        pending.mimeType = data.mimeType || 'application/octet-stream';
        break;

      case 'chunk':
        // Data chunk - enqueue to stream
        if (pending.controller && data.data) {
          try {
            pending.controller.enqueue(new Uint8Array(data.data));
          } catch (e) {
            console.error('[SW] Error enqueueing chunk:', e);
          }
        }
        // Check if this is the final chunk
        if (data.done) {
          if (pending.controller) {
            try {
              pending.controller.close();
            } catch {
              // Stream may already be closed
            }
          }
          pendingRequests.delete(reqId);
        }
        break;

      case 'error':
        // Error occurred
        if (pending.controller) {
          try {
            pending.controller.error(new Error(data.message));
          } catch {
            // Stream may already be closed
          }
        }
        pending.reject(new Error(data.message || 'Unknown error'));
        pendingRequests.delete(reqId);
        break;
    }
  };
}

/**
 * Parse Range header
 */
function parseRangeHeader(rangeHeader: string | null, totalSize: number): { start: number; end: number } | null {
  if (!rangeHeader) return null;

  const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
  if (!match) return null;

  const start = match[1] ? parseInt(match[1], 10) : 0;
  const end = match[2] ? parseInt(match[2], 10) : totalSize - 1;

  return { start, end };
}

/**
 * Create a streaming response for media requests
 */
async function createMediaResponse(
  cidHex: string,
  path: string,
  rangeHeader: string | null
): Promise<Response> {
  if (!workerPort) {
    return new Response('Worker not connected', { status: 503 });
  }

  const id = `media_${++requestId}`;

  return new Promise((resolve, reject) => {
    // Parse range if provided
    let rangeStart = 0;
    let rangeEnd: number | undefined;

    // We'll get the total size from the worker's headers response
    // For now, parse what we can from the range header
    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
      if (match) {
        rangeStart = match[1] ? parseInt(match[1], 10) : 0;
        rangeEnd = match[2] ? parseInt(match[2], 10) : undefined;
      }
    }

    // Create a readable stream that will receive chunks from the worker
    let streamController: ReadableStreamDefaultController<Uint8Array>;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
      cancel() {
        pendingRequests.delete(id);
        // Could notify worker to stop sending data
      }
    });

    // Store pending request
    const pending = {
      resolve,
      reject,
      controller: null as ReadableStreamDefaultController<Uint8Array> | null,
      totalSize: 0,
      mimeType: 'application/octet-stream',
      rangeStart,
      rangeEnd,
    };
    pendingRequests.set(id, pending);

    // Send request to worker (matches MediaRequest in protocol.ts)
    workerPort!.postMessage({
      type: 'media',
      requestId: id,
      cid: cidHex,
      start: rangeStart,
      end: rangeEnd,
      mimeType: guessMimeType(path),
    });

    // Wait a bit for headers response, then create the Response
    // The worker should send headers first, then chunks
    setTimeout(() => {
      const p = pendingRequests.get(id);
      if (!p) return;

      p.controller = streamController;

      const headers: Record<string, string> = {
        'Content-Type': p.mimeType,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=31536000, immutable',
      };

      const isRangeRequest = rangeHeader !== null;
      let status = 200;
      let statusText = 'OK';

      if (p.totalSize > 0) {
        if (isRangeRequest) {
          const end = p.rangeEnd !== undefined ? p.rangeEnd : p.totalSize - 1;
          headers['Content-Range'] = `bytes ${rangeStart}-${end}/${p.totalSize}`;
          headers['Content-Length'] = String(end - rangeStart + 1);
          status = 206;
          statusText = 'Partial Content';
        } else {
          headers['Content-Length'] = String(p.totalSize);
        }
      }

      const response = new Response(stream, {
        status,
        statusText,
        headers,
      });

      resolve(response);
    }, 50); // Give worker 50ms to send headers
  });
}

/**
 * Intercept fetch requests
 */
self.addEventListener('fetch', (event: FetchEvent) => {
  const url = new URL(event.request.url);

  // Check if this is a media request: /media/{cidHex}/{path}
  if (url.pathname.startsWith('/media/')) {
    const pathParts = url.pathname.slice('/media/'.length).split('/');
    if (pathParts.length >= 1) {
      const cidHex = pathParts[0];
      const filePath = pathParts.slice(1).join('/') || '';
      const rangeHeader = event.request.headers.get('Range');

      event.respondWith(createMediaResponse(cidHex, filePath, rangeHeader));
      return;
    }
  }

  // For non-media requests, let workbox handle it (precache + runtime caching)
});

// Handle service worker installation
self.addEventListener('install', () => {
  console.log('[SW] Installing...');
  self.skipWaiting();
});

// Handle service worker activation
self.addEventListener('activate', (event: ExtendableEvent) => {
  console.log('[SW] Activating...');
  event.waitUntil(self.clients.claim());
});
