/**
 * Service Worker with File Streaming Support
 *
 * Intercepts file requests and streams data from main thread:
 * - /htree/{npub}/{treeName}/{path} - Npub-based file access
 * - /htree/{nhash}/{filename} - Direct nhash access (content-addressed)
 *
 * Uses WebTorrent-style per-request MessageChannel pattern:
 * - SW creates MessageChannel for each request
 * - Posts request to all clients (windows)
 * - First client to respond wins
 * - Client streams chunks back through the port
 *
 * Routes are namespaced under /htree/ for reusability across apps.
 */

/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching';

declare let self: ServiceWorkerGlobalScope;

// Precache static assets (injected by VitePWA)
precacheAndRoute(self.__WB_MANIFEST);

// Request counter for unique IDs
let requestId = 0;

// npub pattern: npub1 followed by 58 bech32 characters
const NPUB_PATTERN = /^npub1[a-z0-9]{58}$/;

// Timeout for port responses
const PORT_TIMEOUT = 5000;

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
}

interface FileResponseHeaders {
  status: number;
  headers: Record<string, string>;
  body: 'STREAM' | string | null;
  totalSize?: number;
}

/**
 * Request file from main thread via per-request MessageChannel
 * Based on WebTorrent's worker-server.js pattern
 */
async function serveFile(request: FileRequest): Promise<Response> {
  const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

  if (clientList.length === 0) {
    return new Response('No clients available', { status: 503 });
  }

  // Create MessageChannel and broadcast to all clients - first to respond wins
  const [data, port] = await new Promise<[FileResponseHeaders, MessagePort]>((resolve, reject) => {
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        reject(new Error('Timeout waiting for client response'));
      }
    }, PORT_TIMEOUT);

    for (const client of clientList) {
      const messageChannel = new MessageChannel();
      const { port1, port2 } = messageChannel;

      port1.onmessage = ({ data }) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve([data, port1]);
        }
      };

      client.postMessage(request, [port2]);
    }
  });

  const cleanup = () => {
    port.postMessage(false); // Signal cancel
    port.onmessage = null;
  };

  // Non-streaming response
  if (data.body !== 'STREAM') {
    cleanup();
    return new Response(data.body, {
      status: data.status,
      headers: data.headers,
    });
  }

  // Streaming response
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  const stream = new ReadableStream({
    pull(controller) {
      return new Promise<void>((resolve) => {
        port.onmessage = ({ data: chunk }) => {
          if (chunk) {
            controller.enqueue(new Uint8Array(chunk));
          } else {
            cleanup();
            controller.close();
          }
          resolve();
        };

        // Clear any previous timeout
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }

        // Timeout for inactive streams (Firefox doesn't support cancel)
        timeoutHandle = setTimeout(() => {
          cleanup();
          resolve();
        }, PORT_TIMEOUT);

        // Request next chunk
        port.postMessage(true);
      });
    },
    cancel() {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      cleanup();
    },
  });

  return new Response(stream, {
    status: data.status,
    headers: data.headers,
  });
}

/**
 * Create file request for npub-based paths
 */
function createNpubFileResponse(
  npub: string,
  treeName: string,
  filePath: string,
  rangeHeader: string | null
): Promise<Response> {
  const id = `file_${++requestId}`;
  const fullPath = filePath ? `${treeName}/${filePath}` : treeName;
  const mimeType = guessMimeType(filePath || treeName);

  let start = 0;
  let end: number | undefined;

  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
    if (match) {
      start = match[1] ? parseInt(match[1], 10) : 0;
      end = match[2] ? parseInt(match[2], 10) : undefined;
    }
  }

  const request: FileRequest = {
    type: 'hashtree-file',
    requestId: id,
    npub,
    treeName,
    path: filePath,
    start,
    end,
    mimeType,
  };

  return serveFile(request).catch((error) => {
    console.error('[SW] File request failed:', error);
    return new Response(`File request failed: ${error.message}`, { status: 500 });
  });
}

/**
 * Create file request for nhash-based paths (content-addressed)
 */
function createNhashFileResponse(
  nhash: string,
  filename: string,
  rangeHeader: string | null
): Promise<Response> {
  const id = `file_${++requestId}`;
  const mimeType = guessMimeType(filename);

  let start = 0;
  let end: number | undefined;

  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
    if (match) {
      start = match[1] ? parseInt(match[1], 10) : 0;
      end = match[2] ? parseInt(match[2], 10) : undefined;
    }
  }

  const request: FileRequest = {
    type: 'hashtree-file',
    requestId: id,
    nhash,
    path: filename,
    start,
    end,
    mimeType,
  };

  return serveFile(request).catch((error) => {
    console.error('[SW] File request failed:', error);
    return new Response(`File request failed: ${error.message}`, { status: 500 });
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

  // All hashtree routes start with /htree/
  if (pathParts[0] !== 'htree') return;

  // /htree/{nhash}/{filename} - Direct nhash access (content-addressed)
  if (pathParts.length >= 2 && pathParts[1].startsWith('nhash1')) {
    const nhash = pathParts[1];
    const filename = pathParts.slice(2).join('/') || 'file';
    event.respondWith(createNhashFileResponse(nhash, filename, rangeHeader));
    return;
  }

  // /htree/{npub}/{treeName}/{path...} - Npub-based file access
  // treeName is URL-encoded (may contain %2F for slashes)
  if (pathParts.length >= 3 && NPUB_PATTERN.test(pathParts[1])) {
    const npub = pathParts[1];
    const treeName = decodeURIComponent(pathParts[2]);
    const filePath = pathParts.slice(3).map(decodeURIComponent).join('/');
    event.respondWith(createNpubFileResponse(npub, treeName, filePath, rangeHeader));
    return;
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
