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

import { HashTree } from '../../../hashtree/src/hashtree';
import { DexieStore } from '../../../hashtree/src/store/dexie';
import { BlossomStore } from '../../../hashtree/src/store/blossom';
import type { WorkerRequest, WorkerResponse, WorkerConfig, SignedEvent, WebRTCCommand } from './protocol';
import { initTreeRootCache, getCachedRoot, clearMemoryCache } from './treeRootCache';
import {
  initNdk,
  closeNdk,
  subscribe as ndkSubscribe,
  unsubscribe as ndkUnsubscribe,
  publish as ndkPublish,
  setOnEvent,
  setOnEose,
  getRelayStats as getNdkRelayStats,
} from './ndk';
import { initIdentity, setIdentity, clearIdentity } from './identity';
import {
  setResponseSender,
  signEvent,
  handleSignedResponse,
  handleEncryptedResponse,
  handleDecryptedResponse,
} from './signing';
import { WebRTCController } from './webrtc';
import { SocialGraph, type NostrEvent as SocialGraphNostrEvent } from 'nostr-social-graph';
import { LRUCache } from '../utils/lruCache';
import { initMediaHandler, registerMediaPort } from './mediaHandler';
import {
  initWebRTCSignaling,
  sendWebRTCSignaling,
  setupWebRTCSignalingSubscription,
  handleWebRTCSignalingEvent,
} from './webrtcSignaling';

// Worker state
let tree: HashTree | null = null;
let store: DexieStore | null = null;
let blossomStore: BlossomStore | null = null;
let webrtc: WebRTCController | null = null;
let webrtcStarted = false;
let _config: WorkerConfig | null = null;

// Follows set for WebRTC peer classification
let followsSet = new Set<string>();

function getFollows(): Set<string> {
  return followsSet;
}

// SocialGraph state
const DEFAULT_SOCIAL_GRAPH_ROOT = '4523be58d395b1b196a9b8c82b038b6895cb02b683d0c253a955068dba1facd0';
const KIND_CONTACTS = 3;  // kind:3 = contact list
let socialGraph: SocialGraph = new SocialGraph(DEFAULT_SOCIAL_GRAPH_ROOT);
let socialGraphVersion = 0;

function notifySocialGraphVersionUpdate() {
  socialGraphVersion++;
  self.postMessage({ type: 'socialGraphVersion', version: socialGraphVersion });
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
        registerMediaPort(msg.port);
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
        if (webrtc) {
          webrtc.setPoolConfig(msg.pools);
          // Start WebRTC on first pool config (waits for settings to load)
          if (!webrtcStarted) {
            webrtc.start();
            webrtcStarted = true;
            console.log('[Worker] WebRTC controller started (after pool config)');
          }
        }
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
        handleInitSocialGraph(msg.id, msg.rootPubkey);
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
        handleGetFollowsList(msg.id, msg.pubkey);
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

    // Initialize NDK with relays, cache, and nostr-wasm verification
    await initNdk(cfg.relays, {
      pubkey: cfg.pubkey,
      nsec: cfg.nsec,
    });
    console.log('[Worker] NDK initialized with', cfg.relays.length, 'relays');

    // Set up unified event handler for all subscriptions
    setOnEvent((subId, event) => {
      console.log('[Worker] NDK event:', subId, 'kind:', event.kind, 'from:', event.pubkey?.slice(0, 8));

      // Forward to main thread
      respond({ type: 'event', subId, event });

      // Route to WebRTC handler
      if (subId.startsWith('webrtc-')) {
        handleWebRTCSignalingEvent(event);
      }

      // Route to SocialGraph handler
      if (subId === 'socialgraph-contacts' && event.kind === KIND_CONTACTS) {
        handleSocialGraphEvent(event);
      }
    });

    // Set up EOSE handler
    setOnEose((subId) => {
      respond({ type: 'eose', subId });
    });

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

    // Initialize media handler with the tree
    initMediaHandler(tree);

    // Initialize WebRTC signaling with the controller
    initWebRTCSignaling(webrtc);

    // Subscribe to WebRTC signaling events (kind 25050)
    setupWebRTCSignalingSubscription(cfg.pubkey);

    // WebRTC starts when pool config is received (waits for settings to load)
    console.log('[Worker] WebRTC controller ready (waiting for pool config)');

    // Initialize SocialGraph with user's pubkey as root
    socialGraph = new SocialGraph(cfg.pubkey);
    console.log('[Worker] SocialGraph initialized with root:', cfg.pubkey.slice(0, 16) + '...');

    // Subscribe to kind:3 (contact list) events for social graph
    setupSocialGraphSubscription(cfg.pubkey);

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

  // Update SocialGraph root
  socialGraph.setRoot(pubkey);
  notifySocialGraphVersionUpdate();
  console.log('[Worker] SocialGraph root updated:', pubkey.slice(0, 16) + '...');

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
  // NOTE: WebRTC not available in workers
  // Close NDK connections
  closeNdk();
  // Clear identity
  clearIdentity();
  // Clear caches
  clearMemoryCache();
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

  // 2. If not found locally, try WebRTC peers with timeout
  // After timeout, move on to blossom but let WebRTC continue in background
  if (!data && webrtc) {
    const WEBRTC_TIMEOUT = 1000;
    const webrtcPromise = webrtc.get(hash);

    // Race WebRTC against timeout
    const timeoutPromise = new Promise<null>(resolve => setTimeout(() => resolve(null), WEBRTC_TIMEOUT));
    data = await Promise.race([webrtcPromise, timeoutPromise]);

    if (data) {
      await store.put(hash, data);
    } else {
      // WebRTC timed out, let it continue in background and cache if it eventually succeeds
      webrtcPromise.then(async (lateData) => {
        if (lateData && store) {
          await store.put(hash, lateData);
        }
      }).catch(() => {});
    }
  }

  // 3. If not found from peers, try Blossom servers
  if (!data && blossomStore) {
    data = await blossomStore.get(hash);
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

  // Fire-and-forget push to blossom (don't await - optimistic upload)
  if (blossomStore && success) {
    blossomStore.put(hash, data).catch((err) => {
      // Log blossom errors but don't fail - local storage succeeded
      const hashHex = Array.from(hash.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join('');
      console.warn(`[Worker] Blossom upload failed for ${hashHex}...:`, err instanceof Error ? err.message : err);
      // Notify main thread of upload failure
      respond({ type: 'blossomUploadError', hash: hashHex, error: err instanceof Error ? err.message : String(err) } as WorkerResponse);
    });
  }
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
    // Use the request id as the subscription id
    ndkSubscribe(id, filters);
    respond({ type: 'void', id });
  } catch (err) {
    respond({ type: 'void', id, error: err instanceof Error ? err.message : String(err) });
  }
}

async function handleUnsubscribe(id: string, subId: string) {
  try {
    ndkUnsubscribe(subId);
    respond({ type: 'void', id });
  } catch (err) {
    respond({ type: 'void', id, error: err instanceof Error ? err.message : String(err) });
  }
}

async function handlePublish(id: string, event: SignedEvent) {
  try {
    await ndkPublish(event);
    respond({ type: 'void', id });
  } catch (err) {
    respond({ type: 'void', id, error: err instanceof Error ? err.message : String(err) });
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
    const stats = getNdkRelayStats();
    respond({ type: 'relayStats', id, stats });
  } catch {
    respond({ type: 'relayStats', id, stats: [] });
  }
}

// ============================================================================
// SocialGraph Handlers
// ============================================================================

function handleInitSocialGraph(id: string, rootPubkey?: string) {
  try {
    if (rootPubkey) {
      socialGraph = new SocialGraph(rootPubkey);
    }
    const size = socialGraph.size();
    respond({ type: 'socialGraphInit', id, version: socialGraphVersion, size });
  } catch (err) {
    respond({ type: 'socialGraphInit', id, version: 0, size: 0, error: err instanceof Error ? err.message : String(err) });
  }
}

function handleSetSocialGraphRoot(id: string, pubkey: string) {
  try {
    socialGraph.setRoot(pubkey);
    // Update followsSet for WebRTC peer classification
    const follows = socialGraph.getFollowedByUser(pubkey);
    followsSet = new Set(follows);
    notifySocialGraphVersionUpdate();
    respond({ type: 'void', id });
  } catch (err) {
    respond({ type: 'void', id, error: err instanceof Error ? err.message : String(err) });
  }
}

function handleSocialGraphEvents(id: string, events: SocialGraphNostrEvent[]) {
  try {
    let updated = false;
    for (const event of events) {
      socialGraph.handleEvent(event);
      updated = true;
    }
    if (updated) {
      notifySocialGraphVersionUpdate();
    }
    respond({ type: 'void', id });
  } catch (err) {
    respond({ type: 'void', id, error: err instanceof Error ? err.message : String(err) });
  }
}

function handleGetFollowDistance(id: string, pubkey: string) {
  try {
    const distance = socialGraph.getFollowDistance(pubkey);
    respond({ type: 'followDistance', id, distance });
  } catch (err) {
    respond({ type: 'followDistance', id, distance: 1000, error: err instanceof Error ? err.message : String(err) });
  }
}

function handleIsFollowing(id: string, follower: string, followed: string) {
  try {
    const result = socialGraph.isFollowing(follower, followed);
    respond({ type: 'isFollowingResult', id, result });
  } catch (err) {
    respond({ type: 'isFollowingResult', id, result: false, error: err instanceof Error ? err.message : String(err) });
  }
}

function handleGetFollowsList(id: string, pubkey: string) {
  try {
    const follows = socialGraph.getFollowedByUser(pubkey);
    respond({ type: 'pubkeyList', id, pubkeys: Array.from(follows) });
  } catch (err) {
    respond({ type: 'pubkeyList', id, pubkeys: [], error: err instanceof Error ? err.message : String(err) });
  }
}

function handleGetFollowers(id: string, pubkey: string) {
  try {
    const followers = socialGraph.getFollowersByUser(pubkey);
    respond({ type: 'pubkeyList', id, pubkeys: Array.from(followers) });
  } catch (err) {
    respond({ type: 'pubkeyList', id, pubkeys: [], error: err instanceof Error ? err.message : String(err) });
  }
}

function handleGetFollowedByFriends(id: string, pubkey: string) {
  try {
    const friendsFollowing = socialGraph.getFollowedByFriends(pubkey);
    respond({ type: 'pubkeyList', id, pubkeys: Array.from(friendsFollowing) });
  } catch (err) {
    respond({ type: 'pubkeyList', id, pubkeys: [], error: err instanceof Error ? err.message : String(err) });
  }
}

function handleGetSocialGraphSize(id: string) {
  try {
    const size = socialGraph.size();
    respond({ type: 'socialGraphSize', id, size });
  } catch (err) {
    respond({ type: 'socialGraphSize', id, size: 0, error: err instanceof Error ? err.message : String(err) });
  }
}

// ============================================================================
// SocialGraph Subscription
// ============================================================================

// Track latest event per pubkey to avoid processing old events (for social graph)
// Limited to 1000 entries to prevent memory leak from encountering many unique pubkeys
const socialGraphLatestByPubkey = new LRUCache<string, number>(1000);

/**
 * Handle incoming SocialGraph event (kind:3)
 */
function handleSocialGraphEvent(event: SignedEvent): void {
  const rootPubkey = socialGraph.getRoot();

  const prevTime = socialGraphLatestByPubkey.get(event.pubkey) || 0;
  if (event.created_at > prevTime) {
    socialGraphLatestByPubkey.set(event.pubkey, event.created_at);
    socialGraph.handleEvent(event as SocialGraphNostrEvent);

    // If this is the root user's contact list, update followsSet for WebRTC
    if (event.pubkey === rootPubkey) {
      const follows = socialGraph.getFollowedByUser(rootPubkey);
      followsSet = new Set(follows);
      console.log('[Worker] Follows updated:', followsSet.size, 'pubkeys');

      // Broadcast hello so peers can re-classify with updated follows
      webrtc?.broadcastHello();
    }

    notifySocialGraphVersionUpdate();
  }
}

/**
 * Subscribe to kind:3 contact list events for social graph
 */
function setupSocialGraphSubscription(rootPubkey: string): void {
  if (!rootPubkey || rootPubkey.length !== 64) {
    console.warn('[Worker] Invalid pubkey for social graph subscription:', rootPubkey);
    return;
  }

  // NOTE: Don't call setOnEvent here - use the unified handler set up in handleInit

  // Subscribe to contact lists from root user
  ndkSubscribe('socialgraph-contacts', [{
    kinds: [KIND_CONTACTS],
    authors: [rootPubkey],
  }]);

  console.log('[Worker] Subscribed to kind:3 events for social graph');
}

