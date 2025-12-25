/**
 * Social Graph Worker
 * Handles social graph operations off the main thread
 */
import { SocialGraph, type NostrEvent } from 'nostr-social-graph';

const DEFAULT_ROOT = '4523be58d395b1b196a9b8c82b038b6895cb02b683d0c253a955068dba1facd0';
const DB_NAME = 'hashtree-social-graph-worker';
const STORE_NAME = 'graph';
const SAVE_THROTTLE_MS = 15000;

let graph: SocialGraph = new SocialGraph(DEFAULT_ROOT);
let db: IDBDatabase | null = null;
let saveTimeout: ReturnType<typeof setTimeout> | null = null;
let version = 0;

// Message types
type WorkerRequest =
  | { type: 'init'; id: string; rootPubkey?: string }
  | { type: 'setRoot'; id: string; pubkey: string }
  | { type: 'handleEvents'; id: string; events: NostrEvent[] }
  | { type: 'getFollowDistance'; id: string; pubkey: string }
  | { type: 'isFollowing'; id: string; follower: string; followed: string }
  | { type: 'getFollows'; id: string; pubkey: string }
  | { type: 'getFollowers'; id: string; pubkey: string }
  | { type: 'getFollowedByFriends'; id: string; pubkey: string }
  | { type: 'getSize'; id: string }
  | { type: 'getUsersByDistance'; id: string; distance: number };

type WorkerResponse =
  | { type: 'ready'; version: number }
  | { type: 'result'; id: string; data: unknown }
  | { type: 'error'; id: string; error: string }
  | { type: 'versionUpdate'; version: number };

function post(msg: WorkerResponse) {
  self.postMessage(msg);
}

function notifyVersionUpdate() {
  version++;
  post({ type: 'versionUpdate', version });
}

// IndexedDB helpers
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

async function loadFromDB(rootPubkey: string): Promise<SocialGraph | null> {
  try {
    if (!db) db = await openDB();

    return new Promise((resolve) => {
      const tx = db!.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get('main');

      request.onsuccess = async () => {
        if (request.result?.data) {
          try {
            const loaded = await SocialGraph.fromBinary(rootPubkey, request.result.data);
            resolve(loaded);
          } catch {
            resolve(null);
          }
        } else {
          resolve(null);
        }
      };
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function saveToDB() {
  try {
    if (!db) db = await openDB();
    const data = await graph.toBinary();

    return new Promise<void>((resolve) => {
      const tx = db!.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put({ data, updatedAt: Date.now() }, 'main');
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch (err) {
    console.error('[socialGraph.worker] save error:', err);
  }
}

function scheduleSave() {
  if (saveTimeout) return;
  saveTimeout = setTimeout(async () => {
    saveTimeout = null;
    await saveToDB();
  }, SAVE_THROTTLE_MS);
}

// Handle messages
self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;

  try {
    switch (msg.type) {
      case 'init': {
        const rootPubkey = msg.rootPubkey || DEFAULT_ROOT;
        const loaded = await loadFromDB(rootPubkey);
        if (loaded) {
          graph = loaded;
        } else {
          graph.setRoot(rootPubkey);
        }
        post({ type: 'ready', version });
        post({ type: 'result', id: msg.id, data: { size: graph.size() } });
        break;
      }

      case 'setRoot': {
        graph.setRoot(msg.pubkey);
        notifyVersionUpdate();
        post({ type: 'result', id: msg.id, data: true });
        break;
      }

      case 'handleEvents': {
        if (msg.events.length > 0) {
          graph.handleEvent(msg.events);
          scheduleSave();
          notifyVersionUpdate();
        }
        post({ type: 'result', id: msg.id, data: msg.events.length });
        break;
      }

      case 'getFollowDistance': {
        const distance = graph.getFollowDistance(msg.pubkey);
        post({ type: 'result', id: msg.id, data: distance });
        break;
      }

      case 'isFollowing': {
        const result = graph.isFollowing(msg.follower, msg.followed);
        post({ type: 'result', id: msg.id, data: result });
        break;
      }

      case 'getFollows': {
        const follows = graph.getFollowedByUser(msg.pubkey);
        post({ type: 'result', id: msg.id, data: Array.from(follows) });
        break;
      }

      case 'getFollowers': {
        const followers = graph.getFollowersByUser(msg.pubkey);
        post({ type: 'result', id: msg.id, data: Array.from(followers) });
        break;
      }

      case 'getFollowedByFriends': {
        const friends = graph.followedByFriends(msg.pubkey);
        post({ type: 'result', id: msg.id, data: Array.from(friends) });
        break;
      }

      case 'getSize': {
        const size = graph.size();
        post({ type: 'result', id: msg.id, data: size });
        break;
      }

      case 'getUsersByDistance': {
        const users = graph.getUsersByFollowDistance(msg.distance);
        post({ type: 'result', id: msg.id, data: Array.from(users) });
        break;
      }
    }
  } catch (err) {
    post({ type: 'error', id: msg.id, error: err instanceof Error ? err.message : String(err) });
  }
};
