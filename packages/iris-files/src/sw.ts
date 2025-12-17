/**
 * Service Worker with File Streaming Support
 *
 * Intercepts file requests and streams data from hashtree worker:
 * - /{npub}/{treeName}/{path} - Npub-based file access, supports live streaming
 * - /cid/{cidHex}/{filename} - Direct CID access
 *
 * All files (video, images, documents) use the same streaming path.
 * Browser handles Content-Type appropriately (seeking for video, rendering for images, etc.)
 * Live streaming works by watching for tree root updates via Nostr.
 */

/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching';

declare let self: ServiceWorkerGlobalScope;

// Precache static assets (injected by VitePWA)
precacheAndRoute(self.__WB_MANIFEST);

// MessagePort for communicating with hashtree worker
let workerPort: MessagePort | null = null;

// Pending requests waiting for worker responses
interface PendingRequest {
  resolve: (response: Response) => void;
  reject: (error: Error) => void;
  controller: ReadableStreamDefaultController<Uint8Array> | null;
  totalSize: number;
  mimeType: string;
  rangeStart: number;
  rangeEnd: number | undefined;
  isLive: boolean;
  resolved: boolean;
}

const pendingRequests = new Map<string, PendingRequest>();

// Request counter for unique IDs
let requestId = 0;

// npub pattern: npub1 followed by 58 bech32 characters
const NPUB_PATTERN = /^npub1[a-z0-9]{58}$/;

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
    'ico': 'image/x-icon',
    // Documents
    'pdf': 'application/pdf',
    'txt': 'text/plain',
    'md': 'text/markdown',
    'html': 'text/html',
    'htm': 'text/html',
    'css': 'text/css',
    'js': 'application/javascript',
    'json': 'application/json',
    'xml': 'application/xml',
    // Archives
    'zip': 'application/zip',
    'tar': 'application/x-tar',
    'gz': 'application/gzip',
    // Code
    'ts': 'text/typescript',
    'tsx': 'text/typescript',
    'jsx': 'text/javascript',
    'py': 'text/x-python',
    'rs': 'text/x-rust',
    'go': 'text/x-go',
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
      // Could be a late message for cancelled request
      return;
    }

    switch (data.type) {
      case 'headers':
        pending.totalSize = data.totalSize;
        pending.mimeType = data.mimeType || pending.mimeType;
        pending.isLive = data.isLive || false;
        break;

      case 'chunk':
        if (pending.controller && data.data) {
          try {
            pending.controller.enqueue(new Uint8Array(data.data));
          } catch (e) {
            console.error('[SW] Error enqueueing chunk:', e);
          }
        }
        break;

      case 'done':
        if (pending.controller) {
          try {
            pending.controller.close();
          } catch {
            // Stream may already be closed
          }
        }
        pendingRequests.delete(reqId);
        break;

      case 'error':
        if (!pending.resolved) {
          pending.reject(new Error(data.message || 'Unknown error'));
        } else if (pending.controller) {
          try {
            pending.controller.error(new Error(data.message));
          } catch {
            // Stream may already be closed
          }
        }
        pendingRequests.delete(reqId);
        break;
    }
  };
}

/**
 * Create streaming response for npub-based file requests
 */
function createNpubFileResponse(
  npub: string,
  treeName: string,
  filePath: string,
  rangeHeader: string | null
): Promise<Response> {
  if (!workerPort) {
    return Promise.resolve(new Response('Worker not connected', { status: 503 }));
  }

  const id = `file_${++requestId}`;
  const fullPath = filePath ? `${treeName}/${filePath}` : treeName;
  const mimeType = guessMimeType(filePath || treeName);

  return new Promise((resolve, reject) => {
    let rangeStart = 0;
    let rangeEnd: number | undefined;

    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
      if (match) {
        rangeStart = match[1] ? parseInt(match[1], 10) : 0;
        rangeEnd = match[2] ? parseInt(match[2], 10) : undefined;
      }
    }

    let streamController: ReadableStreamDefaultController<Uint8Array>;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
      cancel() {
        pendingRequests.delete(id);
        workerPort?.postMessage({ type: 'cancelMedia', requestId: id });
      }
    });

    const pending: PendingRequest = {
      resolve,
      reject,
      controller: null,
      totalSize: 0,
      mimeType,
      rangeStart,
      rangeEnd,
      isLive: false,
      resolved: false,
    };
    pendingRequests.set(id, pending);

    // Send request to worker
    workerPort!.postMessage({
      type: 'mediaByPath',
      requestId: id,
      npub,
      path: fullPath,
      start: rangeStart,
      end: rangeEnd,
      mimeType,
    });

    // Wait for headers, then resolve with Response
    setTimeout(() => {
      const p = pendingRequests.get(id);
      if (!p || p.resolved) return;
      p.resolved = true;
      p.controller = streamController;

      const headers: Record<string, string> = {
        'Content-Type': p.mimeType,
      };

      let status = 200;
      let statusText = 'OK';

      // For live streams, don't set Content-Length (chunked transfer)
      if (p.isLive) {
        headers['Accept-Ranges'] = 'none';
        headers['Cache-Control'] = 'no-cache, no-store';
      } else {
        headers['Accept-Ranges'] = 'bytes';
        headers['Cache-Control'] = 'public, max-age=31536000, immutable';

        if (p.totalSize > 0 && rangeHeader) {
          const end = p.rangeEnd !== undefined ? p.rangeEnd : p.totalSize - 1;
          headers['Content-Range'] = `bytes ${rangeStart}-${end}/${p.totalSize}`;
          headers['Content-Length'] = String(end - rangeStart + 1);
          status = 206;
          statusText = 'Partial Content';
        } else if (p.totalSize > 0) {
          headers['Content-Length'] = String(p.totalSize);
        }
      }

      resolve(new Response(stream, { status, statusText, headers }));
    }, 50);
  });
}

/**
 * Create streaming response for direct CID requests
 */
function createCidFileResponse(
  cidHex: string,
  filename: string,
  rangeHeader: string | null
): Promise<Response> {
  if (!workerPort) {
    return Promise.resolve(new Response('Worker not connected', { status: 503 }));
  }

  const id = `file_${++requestId}`;
  const mimeType = guessMimeType(filename);

  return new Promise((resolve, reject) => {
    let rangeStart = 0;
    let rangeEnd: number | undefined;

    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
      if (match) {
        rangeStart = match[1] ? parseInt(match[1], 10) : 0;
        rangeEnd = match[2] ? parseInt(match[2], 10) : undefined;
      }
    }

    let streamController: ReadableStreamDefaultController<Uint8Array>;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
      cancel() {
        pendingRequests.delete(id);
        workerPort?.postMessage({ type: 'cancelMedia', requestId: id });
      }
    });

    const pending: PendingRequest = {
      resolve,
      reject,
      controller: null,
      totalSize: 0,
      mimeType,
      rangeStart,
      rangeEnd,
      isLive: false,
      resolved: false,
    };
    pendingRequests.set(id, pending);

    // Send CID-based request
    workerPort!.postMessage({
      type: 'media',
      requestId: id,
      cid: cidHex,
      start: rangeStart,
      end: rangeEnd,
      mimeType,
    });

    // Wait for headers, then resolve with Response
    setTimeout(() => {
      const p = pendingRequests.get(id);
      if (!p || p.resolved) return;
      p.resolved = true;
      p.controller = streamController;

      const headers: Record<string, string> = {
        'Content-Type': p.mimeType,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=31536000, immutable',
      };

      let status = 200;
      let statusText = 'OK';

      if (p.totalSize > 0 && rangeHeader) {
        const end = p.rangeEnd !== undefined ? p.rangeEnd : p.totalSize - 1;
        headers['Content-Range'] = `bytes ${rangeStart}-${end}/${p.totalSize}`;
        headers['Content-Length'] = String(end - rangeStart + 1);
        status = 206;
        statusText = 'Partial Content';
      } else if (p.totalSize > 0) {
        headers['Content-Length'] = String(p.totalSize);
      }

      resolve(new Response(stream, { status, statusText, headers }));
    }, 50);
  });
}

/**
 * Intercept fetch requests
 */
self.addEventListener('fetch', (event: FetchEvent) => {
  const url = new URL(event.request.url);
  const pathParts = url.pathname.slice(1).split('/'); // Remove leading /
  const rangeHeader = event.request.headers.get('Range');

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // /cid/{cidHex}/{filename} - Direct CID access
  if (pathParts[0] === 'cid' && pathParts.length >= 2 && pathParts[1].length === 64) {
    const cidHex = pathParts[1];
    const filename = pathParts.slice(2).join('/') || 'file';
    event.respondWith(createCidFileResponse(cidHex, filename, rangeHeader));
    return;
  }

  // /{npub}/{treeName}/{path...} - Npub-based file access
  if (pathParts.length >= 2 && NPUB_PATTERN.test(pathParts[0])) {
    const npub = pathParts[0];
    const treeName = pathParts[1];
    const filePath = pathParts.slice(2).join('/');

    // Only intercept if this looks like a file request (has extension or deep path)
    // Skip root tree views which the app should handle
    if (filePath || treeName.includes('.')) {
      event.respondWith(createNpubFileResponse(npub, treeName, filePath, rangeHeader));
      return;
    }
  }

  // Let workbox handle everything else (static assets, app routes)
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
