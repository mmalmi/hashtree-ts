/**
 * Hashtree Worker
 *
 * Dedicated worker that owns:
 * - HashTree + DexieStore (IndexedDB storage)
 * - WebRTC peer connections (P2P data transfer)
 *
 * Main thread communicates via postMessage.
 * NIP-07 signing/encryption delegated back to main thread.
 */

import { HashTree } from '../hashtree';
import { DexieStore } from '../store/dexie';
import { BlossomStore } from '../store/blossom';
import type {
  WorkerRequest,
  WorkerResponse,
  WorkerConfig,
  SignedEvent,
  SocialGraphEvent,
  WebRTCCommand,
} from './protocol';
import { initTreeRootCache, getCachedRoot, clearMemoryCache } from './treeRootCache';
import { getNostrManager, closeNostrManager } from './nostr';
import { initIdentity, setIdentity, clearIdentity } from './identity';
import {
  setResponseSender,
  signEvent,
  giftWrap,
  giftUnwrap,
  handleSignedResponse,
  handleEncryptedResponse,
  handleDecryptedResponse,
} from './signing';
import { WebRTCController } from './webrtc';
import * as socialGraph from './socialGraph';

// Kind for WebRTC signaling (ephemeral, gift-wrapped for directed messages)
const SIGNALING_KIND = 25050;
const HELLO_TAG = 'hello';

// Worker state
let tree: HashTree | null = null;
let store: DexieStore | null = null;
let blossomStore: BlossomStore | null = null;
let webrtc: WebRTCController | null = null;
let _config: WorkerConfig | null = null;
let mediaPort: MessagePort | null = null;

// Follows set for WebRTC peer classification
let followsSet = new Set<string>();

function getFollows(): Set<string> {
  return followsSet;
}

// Set up response sender for signing module
setResponseSender((msg) => self.postMessage(msg));

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
      case 'setIdentity':
        handleSetIdentity(msg.id, msg.pubkey, msg.nsec);
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

      // WebRTC pool configuration
      case 'setWebRTCPools':
        webrtc?.setPoolConfig(msg.pools);
        respond({ type: 'void', id: msg.id });
        break;
      case 'sendWebRTCHello':
        webrtc?.broadcastHello();
        respond({ type: 'void', id: msg.id });
        break;
      case 'setFollows':
        followsSet = new Set(msg.follows);
        console.log('[Worker] Follows updated:', followsSet.size, 'pubkeys');
        respond({ type: 'void', id: msg.id });
        break;

      // SocialGraph operations
      case 'initSocialGraph':
        await handleInitSocialGraph(msg.id, msg.rootPubkey);
        break;
      case 'setSocialGraphRoot':
        handleSetSocialGraphRoot(msg.id, msg.pubkey);
        break;
      case 'handleSocialGraphEvents':
        handleSocialGraphEvents(msg.id, msg.events);
        break;
      case 'getFollowDistance':
        handleGetFollowDistance(msg.id, msg.pubkey);
        break;
      case 'isFollowing':
        handleIsFollowing(msg.id, msg.follower, msg.followed);
        break;
      case 'getFollows':
        handleGetFollows(msg.id, msg.pubkey);
        break;
      case 'getFollowers':
        handleGetFollowers(msg.id, msg.pubkey);
        break;
      case 'getFollowedByFriends':
        handleGetFollowedByFriends(msg.id, msg.pubkey);
        break;
      case 'getSocialGraphSize':
        handleGetSocialGraphSize(msg.id);
        break;
      case 'getUsersByDistance':
        handleGetUsersByDistance(msg.id, msg.distance);
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

      // WebRTC proxy events from main thread
      case 'rtc:peerCreated':
      case 'rtc:peerStateChange':
      case 'rtc:peerClosed':
      case 'rtc:offerCreated':
      case 'rtc:answerCreated':
      case 'rtc:descriptionSet':
      case 'rtc:iceCandidate':
      case 'rtc:iceGatheringComplete':
      case 'rtc:dataChannelOpen':
      case 'rtc:dataChannelMessage':
      case 'rtc:dataChannelClose':
      case 'rtc:dataChannelError':
        webrtc?.handleProxyEvent(msg);
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

    // Initialize Dexie/IndexedDB store
    const storeName = cfg.storeName || 'hashtree-worker';
    store = new DexieStore(storeName);

    // Initialize HashTree with the store
    tree = new HashTree({ store });

    // Initialize tree root cache
    initTreeRootCache(store);

    console.log('[Worker] Initialized with DexieStore:', storeName);

    // Initialize identity
    initIdentity(cfg.pubkey, cfg.nsec);
    console.log('[Worker] User pubkey:', cfg.pubkey.slice(0, 16) + '...');

    // Initialize Blossom store with signer for uploads
    if (cfg.blossomServers && cfg.blossomServers.length > 0) {
      blossomStore = new BlossomStore({
        servers: cfg.blossomServers,  // Pass full config with read/write flags
        signer: createBlossomSigner(),
      });
      console.log('[Worker] Initialized BlossomStore with', cfg.blossomServers.length, 'servers');
    }

    // Initialize NostrManager with relays (NDK)
    const nostr = getNostrManager();
    await nostr.init(cfg.relays);

    // Wire up event callbacks to forward to main thread
    nostr.setOnEvent((subId, event) => {
      respond({ type: 'event', subId, event });
    });
    nostr.setOnEose((subId) => {
      respond({ type: 'eose', subId });
    });

    console.log('[Worker] NostrManager initialized with', cfg.relays.length, 'relays');

    // Initialize WebRTC controller (RTCPeerConnection runs in main thread proxy)
    webrtc = new WebRTCController({
      pubkey: cfg.pubkey,
      localStore: store,
      sendCommand: (cmd: WebRTCCommand) => respond(cmd),
      sendSignaling: async (msg, recipientPubkey) => {
        await sendWebRTCSignaling(msg, recipientPubkey);
      },
      getFollows, // Used to classify peers into follows/other pools
      debug: true,
    });

    // Subscribe to WebRTC signaling events (kind 25050)
    setupWebRTCSignalingSubscription(cfg.pubkey);

    webrtc.start();
    console.log('[Worker] WebRTC controller started');

    respond({ type: 'ready' });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    respond({ type: 'error', id, error });
  }
}

// NOTE: WebRTC cannot run in workers - RTCPeerConnection is not available
// See: https://github.com/w3c/webrtc-extensions/issues/77
// WebRTC must run in main thread and proxy to worker for storage

/**
 * Handle identity change (account switch)
 */
function handleSetIdentity(id: string, pubkey: string, nsec?: string) {
  setIdentity(pubkey, nsec);
  console.log('[Worker] Identity updated:', pubkey.slice(0, 16) + '...');

  // Reinitialize Blossom with new signer
  if (_config?.blossomServers && _config.blossomServers.length > 0) {
    blossomStore = new BlossomStore({
      servers: _config.blossomServers,  // Pass full config with read/write flags
      signer: createBlossomSigner(),
    });
  }

  // NOTE: WebRTC not available in workers

  respond({ type: 'void', id });
}

/**
 * Create Blossom signer using current identity
 */
function createBlossomSigner() {
  return async (event: { kind: 24242; created_at: number; content: string; tags: string[][] }) => {
    const signed = await signEvent({
      kind: event.kind,
      created_at: event.created_at,
      content: event.content,
      tags: event.tags,
    });
    return signed;
  };
}

async function handleClose(id: string) {
  // Close WebRTC
  webrtc?.stop();
  webrtc = null;
  // Close Nostr connections
  closeNostrManager();
  // Close SocialGraph
  socialGraph.closeSocialGraph();
  // Clear identity
  clearIdentity();
  // Clear caches
  clearMemoryCache();
  blossomStore = null;
  store = null;
  tree = null;
  _config = null;
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

  // 1. Try local store first
  let data = await store.get(hash);

  // 2. If not found locally, try WebRTC peers
  if (!data && webrtc) {
    data = await webrtc.get(hash);

    // Cache locally if found from peers
    if (data) {
      await store.put(hash, data);
    }
  }

  // 3. If not found from peers, try Blossom servers
  if (!data && blossomStore) {
    data = await blossomStore.get(hash);

    // Cache locally if found from Blossom
    if (data) {
      await store.put(hash, data);
    }
  }

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
// WebRTC Signaling
// ============================================================================

/**
 * Send WebRTC signaling message via Nostr (kind 25050)
 * - Hello messages: broadcast with #l tag
 * - Directed messages (offer/answer/candidates): gift-wrapped
 */
async function sendWebRTCSignaling(msg: import('../webrtc/types.js').SignalingMessage, recipientPubkey?: string): Promise<void> {
  try {
    const nostr = getNostrManager();

    if (recipientPubkey) {
      // Directed message - gift wrap for privacy
      const innerEvent = {
        kind: SIGNALING_KIND,
        content: JSON.stringify(msg),
        tags: [] as string[][],
      };
      const wrappedEvent = await giftWrap(innerEvent, recipientPubkey);
      await nostr.publish(wrappedEvent);
    } else {
      // Hello message - broadcast with #l tag
      const expiration = Math.floor((Date.now() + 5 * 60 * 1000) / 1000); // 5 minutes
      const event = await signEvent({
        kind: SIGNALING_KIND,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['l', HELLO_TAG],
          ['peerId', msg.peerId],
          ['expiration', expiration.toString()],
        ],
        content: '',
      });
      await nostr.publish(event);
    }
  } catch (err) {
    console.error('[Worker] Failed to send WebRTC signaling:', err);
  }
}

/**
 * Subscribe to WebRTC signaling events
 */
function setupWebRTCSignalingSubscription(myPubkey: string): void {
  const nostr = getNostrManager();
  const since = Math.floor((Date.now() - 60000) / 1000); // Last minute

  // Handle incoming signaling events
  nostr.setOnEvent((subId, event) => {
    if (subId.startsWith('webrtc-')) {
      handleWebRTCSignalingEvent(event);
    }
  });

  // Subscribe to hello messages (broadcast discovery)
  nostr.subscribe('webrtc-hello', [{
    kinds: [SIGNALING_KIND],
    '#l': [HELLO_TAG],
    since,
  }]);

  // Subscribe to directed signaling (offers/answers to us)
  nostr.subscribe('webrtc-directed', [{
    kinds: [SIGNALING_KIND],
    '#p': [myPubkey],
    since,
  }]);

  console.log('[Worker] Subscribed to WebRTC signaling');
}

/**
 * Handle incoming WebRTC signaling event
 */
async function handleWebRTCSignalingEvent(event: SignedEvent): Promise<void> {
  // Filter out old events
  const eventAge = Date.now() / 1000 - (event.created_at ?? 0);
  if (eventAge > 60) return; // Ignore events older than 1 minute

  // Check expiration
  const expirationTag = event.tags.find(t => t[0] === 'expiration');
  if (expirationTag) {
    const expiration = parseInt(expirationTag[1], 10);
    if (expiration < Date.now() / 1000) return;
  }

  // Check if it's a hello message (has #l tag)
  const isHello = event.tags.some(t => t[0] === 'l' && t[1] === HELLO_TAG);

  if (isHello) {
    // Hello message - extract peerId from tag
    const peerIdTag = event.tags.find(t => t[0] === 'peerId');
    if (peerIdTag) {
      const msg: import('../webrtc/types.js').SignalingMessage = {
        type: 'hello',
        peerId: peerIdTag[1],
      };
      webrtc?.handleSignalingMessage(msg, event.pubkey);
    }
  } else {
    // Directed message - try to unwrap
    const seal = await giftUnwrap(event);
    if (seal && seal.content) {
      try {
        const msg = JSON.parse(seal.content) as import('../webrtc/types.js').SignalingMessage;
        webrtc?.handleSignalingMessage(msg, seal.pubkey);
      } catch {
        // Invalid JSON, ignore
      }
    }
  }
}

// ============================================================================
// Stats Handlers
// ============================================================================

async function handleGetPeerStats(id: string) {
  if (!webrtc) {
    respond({ type: 'peerStats', id, stats: [] });
    return;
  }

  const controllerStats = webrtc.getPeerStats();
  const stats = controllerStats.map(s => ({
    peerId: s.peerId,
    pubkey: s.pubkey,
    connected: s.connected,
    requestsSent: s.requestsSent,
    requestsReceived: s.requestsReceived,
    responsesSent: s.responsesSent,
    responsesReceived: s.responsesReceived,
    bytesSent: s.bytesSent,
    bytesReceived: s.bytesReceived,
  }));
  respond({ type: 'peerStats', id, stats });
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
// SocialGraph Handlers
// ============================================================================

async function handleInitSocialGraph(id: string, rootPubkey?: string) {
  try {
    // Set up version update callback
    socialGraph.setOnVersionUpdate((version) => {
      respond({ type: 'socialGraphVersion', version });
    });

    const result = await socialGraph.initSocialGraph(rootPubkey);
    respond({ type: 'socialGraphReady', id, version: result.version, size: result.size });
  } catch (err) {
    respond({ type: 'error', id, error: err instanceof Error ? err.message : String(err) });
  }
}

function handleSetSocialGraphRoot(id: string, pubkey: string) {
  socialGraph.setRoot(pubkey);
  respond({ type: 'void', id });
}

function handleSocialGraphEvents(id: string, events: SocialGraphEvent[]) {
  socialGraph.handleEvents(events);
  respond({ type: 'void', id });
}

function handleGetFollowDistance(id: string, pubkey: string) {
  const distance = socialGraph.getFollowDistance(pubkey);
  respond({ type: 'followDistance', id, distance });
}

function handleIsFollowing(id: string, follower: string, followed: string) {
  const result = socialGraph.isFollowing(follower, followed);
  respond({ type: 'isFollowingResult', id, result });
}

function handleGetFollows(id: string, pubkey: string) {
  const pubkeys = socialGraph.getFollows(pubkey);
  respond({ type: 'pubkeyList', id, pubkeys });
}

function handleGetFollowers(id: string, pubkey: string) {
  const pubkeys = socialGraph.getFollowers(pubkey);
  respond({ type: 'pubkeyList', id, pubkeys });
}

function handleGetFollowedByFriends(id: string, pubkey: string) {
  const pubkeys = socialGraph.getFollowedByFriends(pubkey);
  respond({ type: 'pubkeyList', id, pubkeys });
}

function handleGetSocialGraphSize(id: string) {
  const size = socialGraph.getSize();
  respond({ type: 'socialGraphSize', id, size });
}

function handleGetUsersByDistance(id: string, distance: number) {
  const pubkeys = socialGraph.getUsersByDistance(distance);
  respond({ type: 'pubkeyList', id, pubkeys });
}
