/**
 * Social Graph Module for Worker
 *
 * Manages the social graph (follow relationships) using nostr-social-graph.
 * Subscribes to kind:3 events via NDK and maintains the graph.
 */

import { SocialGraph } from 'nostr-social-graph';
import { getNostrManager } from './nostr';
import type { SocialGraphEvent } from './protocol';

const DEFAULT_ROOT = '4523be58d395b1b196a9b8c82b038b6895cb02b683d0c253a955068dba1facd0';
const DB_NAME = 'hashtree-social-graph';
const STORE_NAME = 'graph';
const SAVE_THROTTLE_MS = 15000;

// Social graph state
let graph: SocialGraph = new SocialGraph(DEFAULT_ROOT);
let db: IDBDatabase | null = null;
let saveTimeout: ReturnType<typeof setTimeout> | null = null;
let version = 0;
let initialized = false;

// Callback for version updates
let onVersionUpdate: ((version: number) => void) | null = null;

/**
 * Set callback for version updates
 */
export function setOnVersionUpdate(callback: (version: number) => void): void {
  onVersionUpdate = callback;
}

/**
 * Notify of version update
 */
function notifyVersionUpdate(): void {
  version++;
  onVersionUpdate?.(version);
}

/**
 * Open IndexedDB for persistence
 */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
  });
}

/**
 * Load graph from IndexedDB
 */
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

/**
 * Save graph to IndexedDB
 */
async function saveToDB(): Promise<void> {
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
    console.error('[SocialGraph] save error:', err);
  }
}

/**
 * Schedule a throttled save
 */
function scheduleSave(): void {
  if (saveTimeout) return;
  saveTimeout = setTimeout(async () => {
    saveTimeout = null;
    await saveToDB();
  }, SAVE_THROTTLE_MS);
}

/**
 * Initialize the social graph
 */
export async function initSocialGraph(rootPubkey?: string): Promise<{ version: number; size: number }> {
  const root = rootPubkey || DEFAULT_ROOT;

  // Try to load from IndexedDB
  const loaded = await loadFromDB(root);
  if (loaded) {
    graph = loaded;
  } else {
    graph.setRoot(root);
  }

  initialized = true;

  // Subscribe to kind:3 events via NDK
  subscribeToContactLists();

  const sizeInfo = graph.size();
  console.log('[SocialGraph] Initialized with root:', root.slice(0, 16) + '...', 'users:', sizeInfo.users);

  return { version, size: sizeInfo.users };
}

/**
 * Subscribe to kind:3 (contact list) events via NDK
 */
function subscribeToContactLists(): void {
  const nostr = getNostrManager();

  if (!nostr.isInitialized()) {
    console.log('[SocialGraph] NostrManager not initialized yet, skipping subscription');
    return;
  }

  // Subscribe to contact list events
  // This will receive events for all users we're connected to
  nostr.subscribe('socialGraph-contacts', [{
    kinds: [3],
    // No author filter - receive all contact lists from the network
    // The social graph library will handle relevance
  }]);

  // Events are forwarded via NostrManager's setOnEvent callback
  // which is set up in worker.ts to call handleEvents()
  console.log('[SocialGraph] Subscribed to kind:3 events');
}

/**
 * Set the root pubkey
 */
export function setRoot(pubkey: string): void {
  graph.setRoot(pubkey);
  notifyVersionUpdate();
}

/**
 * Handle incoming contact list events
 */
export function handleEvents(events: SocialGraphEvent[]): number {
  if (events.length === 0) return 0;

  // SocialGraphEvent is compatible with nostr-social-graph's NostrEvent
  graph.handleEvent(events as Parameters<typeof graph.handleEvent>[0]);
  scheduleSave();
  notifyVersionUpdate();

  return events.length;
}

/**
 * Get follow distance for a pubkey
 */
export function getFollowDistance(pubkey: string): number {
  return graph.getFollowDistance(pubkey);
}

/**
 * Check if follower follows followed
 */
export function isFollowing(follower: string, followed: string): boolean {
  return graph.isFollowing(follower, followed);
}

/**
 * Get list of pubkeys a user follows
 */
export function getFollows(pubkey: string): string[] {
  return Array.from(graph.getFollowedByUser(pubkey));
}

/**
 * Get list of pubkeys following a user
 */
export function getFollowers(pubkey: string): string[] {
  return Array.from(graph.getFollowersByUser(pubkey));
}

/**
 * Get pubkeys followed by friends of a user
 */
export function getFollowedByFriends(pubkey: string): string[] {
  return Array.from(graph.followedByFriends(pubkey));
}

/**
 * Get size of the graph (number of users)
 */
export function getSize(): number {
  return graph.size().users;
}

/**
 * Get users by follow distance
 */
export function getUsersByDistance(distance: number): string[] {
  return Array.from(graph.getUsersByFollowDistance(distance));
}

/**
 * Get current version
 */
export function getVersion(): number {
  return version;
}

/**
 * Check if initialized
 */
export function isInitialized(): boolean {
  return initialized;
}

/**
 * Close and cleanup
 */
export function closeSocialGraph(): void {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }

  // Force save before closing
  saveToDB().catch(console.error);

  // Unsubscribe
  const nostr = getNostrManager();
  nostr.unsubscribe('socialGraph-contacts');

  initialized = false;
  console.log('[SocialGraph] Closed');
}
