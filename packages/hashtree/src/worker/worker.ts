/**
 * Hashtree Worker
 *
 * Dedicated worker that owns:
 * - HashTree + OpfsStore (storage)
 * - WebRTC peer connections (P2P data transfer)
 * - Nostr relay connections (signaling + tree roots)
 *
 * Main thread communicates via postMessage.
 * NIP-07 signing/encryption delegated back to main thread.
 */

import { HashTree } from '../hashtree';
import { OpfsStore } from '../store/opfs';
import type {
  WorkerRequest,
  WorkerResponse,
  WorkerConfig,
  SignedEvent,
  UnsignedEvent,
} from './protocol';
import { getNostrManager, closeNostrManager } from './nostr';
import { getWebRTCManager, closeWebRTCManager } from './webrtc';
import { initTreeRootCache, getCachedRoot, clearMemoryCache } from './treeRootCache';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools';
import type { EventTemplate } from 'nostr-tools';

// Worker state
let tree: HashTree | null = null;
let store: OpfsStore | null = null;
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stored for future config access
let _config: WorkerConfig | null = null;
let mediaPort: MessagePort | null = null;

// Ephemeral identity for WebRTC signaling (generated fresh each session)
// This is NOT the user's real identity - just for P2P discovery
let ephemeralSecretKey: Uint8Array | null = null;
let ephemeralPubkey: string | null = null;

// Pending NIP-07 requests (waiting for main thread to sign/encrypt)
const pendingSignRequests = new Map<string, (event: SignedEvent | null, error?: string) => void>();
const pendingEncryptRequests = new Map<string, (ciphertext: string | null, error?: string) => void>();
const pendingDecryptRequests = new Map<string, (plaintext: string | null, error?: string) => void>();

// ============================================================================
// Message Handler
// ============================================================================

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;

  try {
    switch (msg.type) {
      // Lifecycle
      case 'init':
        await handleInit(msg.id, msg.config);
        break;
      case 'close':
        await handleClose(msg.id);
        break;

      // Store operations
      case 'get':
        await handleGet(msg.id, msg.hash);
        break;
      case 'put':
        await handlePut(msg.id, msg.hash, msg.data);
        break;
      case 'has':
        await handleHas(msg.id, msg.hash);
        break;
      case 'delete':
        await handleDelete(msg.id, msg.hash);
        break;

      // Tree operations
      case 'readFile':
        await handleReadFile(msg.id, msg.cid);
        break;
      case 'readFileRange':
        await handleReadFileRange(msg.id, msg.cid, msg.start, msg.end);
        break;
      case 'readFileStream':
        await handleReadFileStream(msg.id, msg.cid);
        break;
      case 'writeFile':
        await handleWriteFile(msg.id, msg.parentCid, msg.path, msg.data);
        break;
      case 'deleteFile':
        await handleDeleteFile(msg.id, msg.parentCid, msg.path);
        break;
      case 'listDir':
        await handleListDir(msg.id, msg.cid);
        break;
      case 'resolveRoot':
        await handleResolveRoot(msg.id, msg.npub, msg.path);
        break;

      // Nostr (TODO: Phase 2)
      case 'subscribe':
        await handleSubscribe(msg.id, msg.filters);
        break;
      case 'unsubscribe':
        await handleUnsubscribe(msg.id, msg.subId);
        break;
      case 'publish':
        await handlePublish(msg.id, msg.event);
        break;

      // Media streaming
      case 'registerMediaPort':
        handleRegisterMediaPort(msg.port);
        break;

      // Stats
      case 'getPeerStats':
        await handleGetPeerStats(msg.id);
        break;
      case 'getRelayStats':
        await handleGetRelayStats(msg.id);
        break;

      // NIP-07 responses from main thread
      case 'signed':
        handleSignedResponse(msg.id, msg.event, msg.error);
        break;
      case 'encrypted':
        handleEncryptedResponse(msg.id, msg.ciphertext, msg.error);
        break;
      case 'decrypted':
        handleDecryptedResponse(msg.id, msg.plaintext, msg.error);
        break;

      default:
        console.warn('[Worker] Unknown message type:', (msg as { type: string }).type);
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error('[Worker] Error handling message:', error);
    respond({ type: 'error', id: (msg as { id?: string }).id, error });
  }
};

// ============================================================================
// Response Helper
// ============================================================================

function respond(msg: WorkerResponse) {
  self.postMessage(msg);
}

function respondWithTransfer(msg: WorkerResponse, transfer: Transferable[]) {
  // Worker scope postMessage takes options object with transfer property
  self.postMessage(msg, { transfer });
}

// ============================================================================
// Lifecycle Handlers
// ============================================================================

async function handleInit(id: string, cfg: WorkerConfig) {
  try {
    _config = cfg;

    // Initialize OPFS store
    const storeName = cfg.storeName || 'hashtree';
    store = new OpfsStore(storeName);
    // OpfsStore self-initializes on first operation

    // Initialize HashTree with the store
    tree = new HashTree({ store });

    // Initialize tree root cache
    initTreeRootCache(store);

    console.log('[Worker] Initialized with store:', storeName);

    // Generate ephemeral identity for WebRTC signaling
    // This is a throwaway keypair - not the user's real identity
    ephemeralSecretKey = generateSecretKey();
    ephemeralPubkey = getPublicKey(ephemeralSecretKey);
    console.log('[Worker] Generated ephemeral pubkey:', ephemeralPubkey.slice(0, 16) + '...');

    // Initialize Nostr relay connections
    if (cfg.relays && cfg.relays.length > 0) {
      const nostr = getNostrManager();
      nostr.init(cfg.relays);

      // Wire up event callbacks to forward to main thread
      nostr.setOnEvent((subId, event) => {
        respond({ type: 'event', subId, event });
      });
      nostr.setOnEose((subId) => {
        respond({ type: 'eose', subId });
      });
    }

    // Initialize WebRTC peer management with ephemeral identity
    const webrtc = getWebRTCManager();
    webrtc.init(store);
    webrtc.start();

    respond({ type: 'ready' });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    respond({ type: 'error', id, error });
  }
}

async function handleClose(id: string) {
  // Close WebRTC connections
  closeWebRTCManager();
  // Close Nostr connections
  closeNostrManager();
  // Clear caches
  clearMemoryCache();
  store = null;
  tree = null;
  _config = null;
  ephemeralSecretKey = null;
  ephemeralPubkey = null;
  respond({ type: 'void', id });
}

// ============================================================================
// Store Handlers (low-level)
// ============================================================================

async function handleGet(id: string, hash: Uint8Array) {
  if (!store) {
    respond({ type: 'result', id, error: 'Store not initialized' });
    return;
  }

  const data = await store.get(hash);
  if (data) {
    // Transfer the ArrayBuffer to avoid copying
    respondWithTransfer({ type: 'result', id, data }, [data.buffer]);
  } else {
    respond({ type: 'result', id, data: undefined });
  }
}

async function handlePut(id: string, hash: Uint8Array, data: Uint8Array) {
  if (!store) {
    respond({ type: 'bool', id, value: false, error: 'Store not initialized' });
    return;
  }

  const success = await store.put(hash, data);
  respond({ type: 'bool', id, value: success });
}

async function handleHas(id: string, hash: Uint8Array) {
  if (!store) {
    respond({ type: 'bool', id, value: false, error: 'Store not initialized' });
    return;
  }

  const exists = await store.has(hash);
  respond({ type: 'bool', id, value: exists });
}

async function handleDelete(id: string, hash: Uint8Array) {
  if (!store) {
    respond({ type: 'bool', id, value: false, error: 'Store not initialized' });
    return;
  }

  const success = await store.delete(hash);
  respond({ type: 'bool', id, value: success });
}

// ============================================================================
// Tree Handlers (high-level)
// ============================================================================

async function handleReadFile(id: string, cid: import('../types').CID) {
  if (!tree) {
    respond({ type: 'result', id, error: 'Tree not initialized' });
    return;
  }

  try {
    const data = await tree.readFile(cid);
    if (data) {
      respondWithTransfer({ type: 'result', id, data }, [data.buffer]);
    } else {
      respond({ type: 'result', id, error: 'File not found' });
    }
  } catch (err) {
    respond({ type: 'result', id, error: err instanceof Error ? err.message : String(err) });
  }
}

async function handleReadFileRange(
  id: string,
  cid: import('../types').CID,
  start: number,
  end?: number
) {
  if (!tree) {
    respond({ type: 'result', id, error: 'Tree not initialized' });
    return;
  }

  try {
    const data = await tree.readFileRange(cid, start, end);
    if (data) {
      respondWithTransfer({ type: 'result', id, data }, [data.buffer]);
    } else {
      respond({ type: 'result', id, error: 'File not found' });
    }
  } catch (err) {
    respond({ type: 'result', id, error: err instanceof Error ? err.message : String(err) });
  }
}

async function handleReadFileStream(id: string, cid: import('../types').CID) {
  if (!tree) {
    respond({ type: 'streamChunk', id, chunk: new Uint8Array(0), done: true });
    return;
  }

  try {
    for await (const chunk of tree.readFileStream(cid)) {
      // Send each chunk, transferring ownership
      respondWithTransfer(
        { type: 'streamChunk', id, chunk, done: false },
        [chunk.buffer]
      );
    }
    // Signal completion
    respond({ type: 'streamChunk', id, chunk: new Uint8Array(0), done: true });
  } catch (err) {
    respond({ type: 'error', id, error: err instanceof Error ? err.message : String(err) });
  }
}

async function handleWriteFile(
  id: string,
  parentCid: import('../types').CID | null,
  path: string,
  data: Uint8Array
) {
  if (!tree) {
    respond({ type: 'cid', id, error: 'Tree not initialized' });
    return;
  }

  try {
    // Parse path to get directory path and filename
    const parts = path.split('/').filter(Boolean);
    const fileName = parts.pop();
    if (!fileName) {
      respond({ type: 'cid', id, error: 'Invalid path' });
      return;
    }

    // First, create a file CID from the data
    const fileResult = await tree.putFile(data);
    const fileCid = fileResult.cid;

    // If no parent, just return the file CID (no directory structure)
    if (!parentCid) {
      respond({ type: 'cid', id, cid: fileCid });
      return;
    }

    // Add the file to the parent directory
    const newRootCid = await tree.setEntry(
      parentCid,
      parts,
      fileName,
      fileCid,
      data.length,
      1 // LinkType.File
    );
    respond({ type: 'cid', id, cid: newRootCid });
  } catch (err) {
    respond({ type: 'cid', id, error: err instanceof Error ? err.message : String(err) });
  }
}

async function handleDeleteFile(
  id: string,
  parentCid: import('../types').CID,
  path: string
) {
  if (!tree) {
    respond({ type: 'cid', id, error: 'Tree not initialized' });
    return;
  }

  try {
    // Parse path to get directory path and filename
    const parts = path.split('/').filter(Boolean);
    const fileName = parts.pop();
    if (!fileName) {
      respond({ type: 'cid', id, error: 'Invalid path' });
      return;
    }

    const newCid = await tree.removeEntry(parentCid, parts, fileName);
    respond({ type: 'cid', id, cid: newCid });
  } catch (err) {
    respond({ type: 'cid', id, error: err instanceof Error ? err.message : String(err) });
  }
}

async function handleListDir(id: string, cidArg: import('../types').CID) {
  if (!tree) {
    respond({ type: 'dirListing', id, error: 'Tree not initialized' });
    return;
  }

  try {
    const entries = await tree.listDirectory(cidArg);

    const dirEntries = entries.map((entry) => ({
      name: entry.name,
      isDir: entry.type === 2, // LinkType.Dir
      size: entry.size,
      cid: entry.cid,
    }));

    respond({ type: 'dirListing', id, entries: dirEntries });
  } catch (err) {
    respond({ type: 'dirListing', id, error: err instanceof Error ? err.message : String(err) });
  }
}

async function handleResolveRoot(id: string, npub: string, path?: string) {
  try {
    // Parse path to get tree name (first segment)
    const pathParts = path?.split('/').filter(Boolean) ?? [];
    const treeName = pathParts[0] || 'public'; // Default to 'public' tree

    // Look up in cache
    const cachedCid = await getCachedRoot(npub, treeName);
    if (cachedCid) {
      respond({ type: 'cid', id, cid: cachedCid });
    } else {
      // Not in cache - main thread should subscribe via Nostr
      respond({ type: 'cid', id, cid: undefined });
    }
  } catch (err) {
    respond({ type: 'cid', id, error: err instanceof Error ? err.message : String(err) });
  }
}

// ============================================================================
// Nostr Handlers
// ============================================================================

async function handleSubscribe(id: string, filters: import('./protocol').NostrFilter[]) {
  try {
    const nostr = getNostrManager();
    // Use the request id as the subscription id
    nostr.subscribe(id, filters);
    respond({ type: 'void', id });
  } catch (err) {
    respond({ type: 'void', id, error: err instanceof Error ? err.message : String(err) });
  }
}

async function handleUnsubscribe(id: string, subId: string) {
  try {
    const nostr = getNostrManager();
    nostr.unsubscribe(subId);
    respond({ type: 'void', id });
  } catch (err) {
    respond({ type: 'void', id, error: err instanceof Error ? err.message : String(err) });
  }
}

async function handlePublish(id: string, event: SignedEvent) {
  try {
    const nostr = getNostrManager();
    await nostr.publish(event);
    respond({ type: 'void', id });
  } catch (err) {
    respond({ type: 'void', id, error: err instanceof Error ? err.message : String(err) });
  }
}

// ============================================================================
// Media Port Handler
// ============================================================================

// Active media streams (for live streaming - can receive updates)
const activeMediaStreams = new Map<string, {
  requestId: string;
  npub: string;
  path: string;
  offset: number;
  cancelled: boolean;
}>();

// Timeout for considering a stream "done" (no updates)
const LIVE_STREAM_TIMEOUT = 10000; // 10 seconds

function handleRegisterMediaPort(port: MessagePort) {
  mediaPort = port;

  port.onmessage = async (e: MessageEvent) => {
    const req = e.data;

    if (req.type === 'media') {
      await handleMediaRequestByCid(req);
    } else if (req.type === 'mediaByPath') {
      await handleMediaRequestByPath(req);
    } else if (req.type === 'cancelMedia') {
      // Cancel an active stream
      const stream = activeMediaStreams.get(req.requestId);
      if (stream) {
        stream.cancelled = true;
        activeMediaStreams.delete(req.requestId);
      }
    }
  };

  console.log('[Worker] Media port registered');
}

// Handle direct CID-based media request
async function handleMediaRequestByCid(req: import('./protocol').MediaRequestByCid) {
  if (!tree || !mediaPort) return;

  const { requestId, cid: cidHex, start, end, mimeType } = req;

  try {
    // Convert hex CID to proper CID object
    const hash = new Uint8Array(cidHex.length / 2);
    for (let i = 0; i < hash.length; i++) {
      hash[i] = parseInt(cidHex.substr(i * 2, 2), 16);
    }
    const cid = { hash };

    // Get file size first
    const totalSize = await tree.getSize(hash);

    // Send headers
    mediaPort.postMessage({
      type: 'headers',
      requestId,
      totalSize,
      mimeType: mimeType || 'application/octet-stream',
      isLive: false,
    } as import('./protocol').MediaResponse);

    // Read range and stream chunks
    const data = await tree.readFileRange(cid, start, end);
    if (data) {
      await streamChunksToPort(requestId, data);
    } else {
      mediaPort.postMessage({
        type: 'error',
        requestId,
        message: 'File not found',
      } as import('./protocol').MediaResponse);
    }
  } catch (err) {
    mediaPort.postMessage({
      type: 'error',
      requestId,
      message: err instanceof Error ? err.message : String(err),
    } as import('./protocol').MediaResponse);
  }
}

// Handle npub/path-based media request (supports live streaming)
async function handleMediaRequestByPath(req: import('./protocol').MediaRequestByPath) {
  if (!tree || !mediaPort) return;

  const { requestId, npub, path, start, mimeType } = req;

  try {
    // Parse path to get tree name
    const pathParts = path.split('/').filter(Boolean);
    const treeName = pathParts[0] || 'public';
    const filePath = pathParts.slice(1).join('/');

    // Resolve npub to current CID
    let cid = await getCachedRoot(npub, treeName);

    if (!cid) {
      // Not in cache - try to resolve via Nostr subscription
      // For now, just return error. Full implementation would subscribe and wait.
      mediaPort.postMessage({
        type: 'error',
        requestId,
        message: `Tree root not found for ${npub}/${treeName}`,
      } as import('./protocol').MediaResponse);
      return;
    }

    // Navigate to file within tree if path specified
    if (filePath) {
      const resolved = await tree.resolvePath(cid, filePath);
      if (!resolved) {
        mediaPort.postMessage({
          type: 'error',
          requestId,
          message: `File not found: ${filePath}`,
        } as import('./protocol').MediaResponse);
        return;
      }
      cid = resolved.cid;
    }

    // Get file size
    const totalSize = await tree.getSize(cid.hash);

    // Send headers (isLive will be determined by watching for updates)
    mediaPort.postMessage({
      type: 'headers',
      requestId,
      totalSize,
      mimeType: mimeType || 'application/octet-stream',
      isLive: false, // Will update if we detect changes
    } as import('./protocol').MediaResponse);

    // Stream initial content
    const data = await tree.readFileRange(cid, start);
    let offset = start;

    if (data) {
      await streamChunksToPort(requestId, data, false); // Don't close yet
      offset += data.length;
    }

    // Register for live updates
    const streamInfo = {
      requestId,
      npub,
      path,
      offset,
      cancelled: false,
    };
    activeMediaStreams.set(requestId, streamInfo);

    // Set up tree root watcher for this npub
    // When root changes, we'll check if this file has new data
    watchTreeRootForStream(npub, treeName, filePath, streamInfo);

  } catch (err) {
    mediaPort.postMessage({
      type: 'error',
      requestId,
      message: err instanceof Error ? err.message : String(err),
    } as import('./protocol').MediaResponse);
  }
}

// Stream data chunks to media port
async function streamChunksToPort(requestId: string, data: Uint8Array, sendDone = true) {
  if (!mediaPort) return;

  const CHUNK_SIZE = 64 * 1024; // 64KB chunks
  for (let offset = 0; offset < data.length; offset += CHUNK_SIZE) {
    const chunk = data.slice(offset, offset + CHUNK_SIZE);
    mediaPort.postMessage(
      { type: 'chunk', requestId, data: chunk } as import('./protocol').MediaResponse,
      [chunk.buffer]
    );
  }

  if (sendDone) {
    mediaPort.postMessage({ type: 'done', requestId } as import('./protocol').MediaResponse);
  }
}

// Watch for tree root updates and push new data to stream
function watchTreeRootForStream(
  npub: string,
  treeName: string,
  filePath: string,
  streamInfo: { requestId: string; offset: number; cancelled: boolean }
) {
  let lastActivity = Date.now();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const checkForUpdates = async () => {
    if (streamInfo.cancelled || !tree || !mediaPort) {
      cleanup();
      return;
    }

    // Check if stream timed out
    if (Date.now() - lastActivity > LIVE_STREAM_TIMEOUT) {
      // No updates for a while, close the stream
      mediaPort.postMessage({ type: 'done', requestId: streamInfo.requestId } as import('./protocol').MediaResponse);
      cleanup();
      return;
    }

    try {
      // Get current root
      const cid = await getCachedRoot(npub, treeName);
      if (!cid) {
        scheduleNext();
        return;
      }

      // Navigate to file
      let fileCid = cid;
      if (filePath) {
        const resolved = await tree.resolvePath(cid, filePath);
        if (!resolved) {
          scheduleNext();
          return;
        }
        fileCid = resolved.cid;
      }

      // Check for new data
      const totalSize = await tree.getSize(fileCid.hash);
      if (totalSize > streamInfo.offset) {
        // New data available!
        lastActivity = Date.now();
        const newData = await tree.readFileRange(fileCid, streamInfo.offset);
        if (newData && newData.length > 0) {
          await streamChunksToPort(streamInfo.requestId, newData, false);
          streamInfo.offset += newData.length;
        }
      }
    } catch {
      // Ignore errors, just try again
    }

    scheduleNext();
  };

  const scheduleNext = () => {
    if (!streamInfo.cancelled) {
      timeoutId = setTimeout(checkForUpdates, 1000); // Check every second
    }
  };

  const cleanup = () => {
    if (timeoutId) clearTimeout(timeoutId);
    activeMediaStreams.delete(streamInfo.requestId);
  };

  // Start watching
  scheduleNext();
}

// ============================================================================
// Stats Handlers
// ============================================================================

async function handleGetPeerStats(id: string) {
  try {
    const webrtc = getWebRTCManager();
    const stats = webrtc.getPeerStats();
    respond({ type: 'peerStats', id, stats });
  } catch {
    respond({ type: 'peerStats', id, stats: [] });
  }
}

async function handleGetRelayStats(id: string) {
  try {
    const nostr = getNostrManager();
    const stats = nostr.getRelayStats();
    respond({ type: 'relayStats', id, stats });
  } catch {
    respond({ type: 'relayStats', id, stats: [] });
  }
}

// ============================================================================
// NIP-07 Response Handlers
// ============================================================================

function handleSignedResponse(id: string, event?: SignedEvent, error?: string) {
  const resolver = pendingSignRequests.get(id);
  if (resolver) {
    pendingSignRequests.delete(id);
    resolver(event || null, error);
  }
}

function handleEncryptedResponse(id: string, ciphertext?: string, error?: string) {
  const resolver = pendingEncryptRequests.get(id);
  if (resolver) {
    pendingEncryptRequests.delete(id);
    resolver(ciphertext || null, error);
  }
}

function handleDecryptedResponse(id: string, plaintext?: string, error?: string) {
  const resolver = pendingDecryptRequests.get(id);
  if (resolver) {
    pendingDecryptRequests.delete(id);
    resolver(plaintext || null, error);
  }
}

// ============================================================================
// Ephemeral Signing (for WebRTC signaling - no main thread roundtrip)
// ============================================================================

/**
 * Sign an event with the ephemeral key (for WebRTC signaling only)
 * This does NOT use the user's real identity - just for P2P discovery
 */
export function signWithEphemeralKey(template: EventTemplate): SignedEvent {
  if (!ephemeralSecretKey) {
    throw new Error('Ephemeral key not initialized');
  }
  const event = finalizeEvent(template, ephemeralSecretKey);
  return {
    id: event.id,
    pubkey: event.pubkey,
    kind: event.kind,
    content: event.content,
    tags: event.tags,
    created_at: event.created_at,
    sig: event.sig,
  };
}

/**
 * Get the ephemeral pubkey (for WebRTC peer ID)
 */
export function getEphemeralPubkey(): string | null {
  return ephemeralPubkey;
}

// ============================================================================
// NIP-07 Request Helpers (for real identity - tree publishing etc)
// ============================================================================

export async function requestSign(event: UnsignedEvent): Promise<SignedEvent> {
  const id = `sign_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  return new Promise((resolve, reject) => {
    pendingSignRequests.set(id, (signed, error) => {
      if (error) reject(new Error(error));
      else if (signed) resolve(signed);
      else reject(new Error('Signing failed'));
    });

    respond({ type: 'signEvent', id, event });

    // Timeout after 60 seconds
    setTimeout(() => {
      if (pendingSignRequests.has(id)) {
        pendingSignRequests.delete(id);
        reject(new Error('Signing timeout'));
      }
    }, 60000);
  });
}

export async function requestEncrypt(pubkey: string, plaintext: string): Promise<string> {
  const id = `enc_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  return new Promise((resolve, reject) => {
    pendingEncryptRequests.set(id, (ciphertext, error) => {
      if (error) reject(new Error(error));
      else if (ciphertext) resolve(ciphertext);
      else reject(new Error('Encryption failed'));
    });

    respond({ type: 'nip44Encrypt', id, pubkey, plaintext });

    setTimeout(() => {
      if (pendingEncryptRequests.has(id)) {
        pendingEncryptRequests.delete(id);
        reject(new Error('Encryption timeout'));
      }
    }, 30000);
  });
}

export async function requestDecrypt(pubkey: string, ciphertext: string): Promise<string> {
  const id = `dec_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  return new Promise((resolve, reject) => {
    pendingDecryptRequests.set(id, (plaintext, error) => {
      if (error) reject(new Error(error));
      else if (plaintext) resolve(plaintext);
      else reject(new Error('Decryption failed'));
    });

    respond({ type: 'nip44Decrypt', id, pubkey, ciphertext });

    setTimeout(() => {
      if (pendingDecryptRequests.has(id)) {
        pendingDecryptRequests.delete(id);
        reject(new Error('Decryption timeout'));
      }
    }, 30000);
  });
}
