/**
 * Social Graph integration using Web Worker
 * Provides follow distance calculations and trust indicators
 * Heavy operations (load/save/recalc) happen in worker
 * Main thread keeps a sync cache for immediate UI access
 */
import { writable, get } from 'svelte/store';
import type { NostrEvent } from 'nostr-social-graph';
import { ndk, nostrStore } from '../nostr';
import type { NDKEvent, NDKSubscription } from '@nostr-dev-kit/ndk';

// Default root pubkey (used when not logged in)
const DEFAULT_SOCIAL_GRAPH_ROOT = '4523be58d395b1b196a9b8c82b038b6895cb02b683d0c253a955068dba1facd0';
const KIND_CONTACTS = 3;
const DEFAULT_CRAWL_DEPTH = 2;

// Debug logging
const DEBUG = false;
const log = (...args: unknown[]) => DEBUG && console.log('[socialGraph]', ...args);

// ============================================================================
// Worker Communication
// ============================================================================

let worker: Worker | null = null;
let requestId = 0;
const pending = new Map<string, { resolve: (data: unknown) => void; reject: (err: Error) => void }>();

function getNextId(): string {
  return `sg-${++requestId}`;
}

function sendToWorker<T>(msg: { type: string; id?: string; [key: string]: unknown }): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!worker) {
      reject(new Error('Worker not initialized'));
      return;
    }
    const id = msg.id || getNextId();
    msg.id = id;
    pending.set(id, { resolve: resolve as (data: unknown) => void, reject });
    worker.postMessage(msg);
  });
}

function handleWorkerMessage(e: MessageEvent) {
  const msg = e.data;

  if (msg.type === 'ready') {
    socialGraphStore.setVersion(msg.version);
    isInitialized = true;
    resolveLoaded?.(true);
    return;
  }

  if (msg.type === 'versionUpdate') {
    socialGraphStore.setVersion(msg.version);
    // Clear sync caches on version update
    followDistanceCache.clear();
    isFollowingCache.clear();
    followsCache.clear();
    followersCache.clear();
    return;
  }

  if (msg.type === 'result' || msg.type === 'error') {
    const handler = pending.get(msg.id);
    if (handler) {
      pending.delete(msg.id);
      if (msg.type === 'error') {
        handler.reject(new Error(msg.error));
      } else {
        handler.resolve(msg.data);
      }
    }
  }
}

// ============================================================================
// Sync Caches (for immediate UI access)
// ============================================================================

const followDistanceCache = new Map<string, number>();
const isFollowingCache = new Map<string, boolean>();
const followsCache = new Map<string, Set<string>>();
const followersCache = new Map<string, Set<string>>();

// ============================================================================
// Svelte Store
// ============================================================================

interface SocialGraphState {
  version: number;
  isRecrawling: boolean;
}

function createSocialGraphStore() {
  const { subscribe, update } = writable<SocialGraphState>({
    version: 0,
    isRecrawling: false,
  });

  return {
    subscribe,
    setVersion: (version: number) => {
      update(state => ({ ...state, version }));
    },
    incrementVersion: () => {
      update(state => ({ ...state, version: state.version + 1 }));
    },
    setIsRecrawling: (value: boolean) => {
      update(state => ({ ...state, isRecrawling: value }));
    },
    getState: (): SocialGraphState => get(socialGraphStore),
  };
}

export const socialGraphStore = createSocialGraphStore();
export const useSocialGraphStore = socialGraphStore;

// ============================================================================
// Initialization
// ============================================================================

let isInitialized = false;
let resolveLoaded: ((value: boolean) => void) | null = null;

export const socialGraphLoaded = new Promise<boolean>((resolve) => {
  resolveLoaded = resolve;
});

export async function initializeSocialGraph() {
  if (worker) return;

  worker = new Worker(
    new URL('../workers/socialGraph.worker.ts', import.meta.url),
    { type: 'module' }
  );

  worker.onmessage = handleWorkerMessage;
  worker.onerror = (err) => {
    console.error('[socialGraph] worker error:', err);
  };

  const currentPublicKey = get(nostrStore).pubkey;
  await sendToWorker({ type: 'init', rootPubkey: currentPublicKey || DEFAULT_SOCIAL_GRAPH_ROOT });
}

// ============================================================================
// Event Handling
// ============================================================================

export function handleSocialGraphEvent(evs: NostrEvent | NostrEvent[]) {
  if (!worker) {
    log('handleSocialGraphEvent called but worker not ready');
    return;
  }
  const events = Array.isArray(evs) ? evs : [evs];
  if (events.length === 0) return;

  // Fire and forget - worker will notify via versionUpdate
  sendToWorker({ type: 'handleEvents', events }).catch(() => {});
}

// ============================================================================
// Public API (sync where possible, async fallback)
// ============================================================================

/**
 * Get follow distance (sync, returns cached or 1000)
 */
export function getFollowDistance(pubkey: string | null | undefined): number {
  if (!pubkey) return 1000;

  const cached = followDistanceCache.get(pubkey);
  if (cached !== undefined) return cached;

  // Trigger async fetch
  if (worker) {
    sendToWorker<number>({ type: 'getFollowDistance', pubkey })
      .then(d => {
        followDistanceCache.set(pubkey, d);
        socialGraphStore.incrementVersion(); // Trigger re-render
      })
      .catch(() => {});
  }
  return 1000;
}

/**
 * Check if one user follows another (sync)
 */
export function isFollowing(
  follower: string | null | undefined,
  followedUser: string | null | undefined
): boolean {
  if (!follower || !followedUser) return false;

  const key = `${follower}:${followedUser}`;
  const cached = isFollowingCache.get(key);
  if (cached !== undefined) return cached;

  // Trigger async fetch
  if (worker) {
    sendToWorker<boolean>({ type: 'isFollowing', follower, followed: followedUser })
      .then(r => {
        isFollowingCache.set(key, r);
        socialGraphStore.incrementVersion();
      })
      .catch(() => {});
  }
  return false;
}

/**
 * Get users followed by a user (sync)
 */
export function getFollows(pubkey: string | null | undefined): Set<string> {
  if (!pubkey) return new Set();

  const cached = followsCache.get(pubkey);
  if (cached) return cached;

  // Trigger async fetch
  if (worker) {
    sendToWorker<string[]>({ type: 'getFollows', pubkey })
      .then(arr => {
        followsCache.set(pubkey, new Set(arr));
        socialGraphStore.incrementVersion();
      })
      .catch(() => {});
  }
  return new Set();
}

/**
 * Get followers of a user (sync)
 */
export function getFollowers(pubkey: string | null | undefined): Set<string> {
  if (!pubkey) return new Set();

  const cached = followersCache.get(pubkey);
  if (cached) return cached;

  // Trigger async fetch
  if (worker) {
    sendToWorker<string[]>({ type: 'getFollowers', pubkey })
      .then(arr => {
        followersCache.set(pubkey, new Set(arr));
        socialGraphStore.incrementVersion();
      })
      .catch(() => {});
  }
  return new Set();
}

/**
 * Get users who follow a given pubkey (from friends)
 */
export function getFollowedByFriends(pubkey: string | null | undefined): Set<string> {
  if (!pubkey) return new Set();

  // Use followers cache as approximation, or fetch
  const cached = followersCache.get(pubkey);
  if (cached) return cached;

  if (worker) {
    sendToWorker<string[]>({ type: 'getFollowedByFriends', pubkey })
      .then(arr => {
        // Store in followers cache
        followersCache.set(pubkey, new Set(arr));
        socialGraphStore.incrementVersion();
      })
      .catch(() => {});
  }
  return new Set();
}

/**
 * Check if a user follows the current logged-in user
 */
export function getFollowsMe(pubkey: string | null | undefined): boolean {
  const myPubkey = get(nostrStore).pubkey;
  if (!pubkey || !myPubkey) return false;
  return isFollowing(pubkey, myPubkey);
}

/**
 * Get the graph size
 */
export function getGraphSize(): number {
  // Return 0 sync, could add async fetch if needed
  return 0;
}

/**
 * Get users at a specific follow distance
 */
export function getUsersByFollowDistance(distance: number): Set<string> {
  // This is rarely used in hot paths, return empty and let caller handle async if needed
  return new Set();
}

// Legacy aliases
export const followDistance = getFollowDistance;
export const followedByFriends = getFollowedByFriends;
export const follows = getFollows;

// Current root pubkey (tracked for e2e tests)
let currentRoot: string = DEFAULT_SOCIAL_GRAPH_ROOT;

// Mock SocialGraph interface for backwards compatibility (e2e tests)
export function getSocialGraph(): { getRoot: () => string } | null {
  return {
    getRoot: () => currentRoot,
  };
}

// ============================================================================
// NDK Subscription Management
// ============================================================================

let sub: NDKSubscription | null = null;

export async function fetchFollowList(publicKey: string): Promise<void> {
  log('fetching own follow list for', publicKey);

  const events = await ndk.fetchEvents({
    kinds: [KIND_CONTACTS],
    authors: [publicKey],
    limit: 1,
  });

  for (const ev of events) {
    handleSocialGraphEvent(ev.rawEvent() as NostrEvent);
  }
}

async function crawlFollowLists(publicKey: string, depth = DEFAULT_CRAWL_DEPTH): Promise<void> {
  if (depth <= 0) return;

  socialGraphStore.setIsRecrawling(true);

  try {
    // Get current follows to crawl
    const rootFollows = await sendToWorker<string[]>({ type: 'getFollows', pubkey: publicKey });

    // Find users we need to fetch follow lists for
    const toFetch: string[] = [];
    for (const pk of rootFollows) {
      const theirFollows = await sendToWorker<string[]>({ type: 'getFollows', pubkey: pk });
      if (theirFollows.length === 0) {
        toFetch.push(pk);
      }
    }

    if (toFetch.length > 0) {
      log('fetching', toFetch.length, 'follow lists at depth 1');
      await fetchFollowListsBatch(toFetch);
    }

    // Depth 2
    if (depth >= 2) {
      const toFetchDepth2: string[] = [];
      const toFetchSet = new Set(toFetch);

      for (const pk of rootFollows) {
        const theirFollows = await sendToWorker<string[]>({ type: 'getFollows', pubkey: pk });
        for (const pk2 of theirFollows) {
          if (!toFetchSet.has(pk2)) {
            const followsOfFollows = await sendToWorker<string[]>({ type: 'getFollows', pubkey: pk2 });
            if (followsOfFollows.length === 0) {
              toFetchDepth2.push(pk2);
              toFetchSet.add(pk2);
            }
          }
        }
      }

      if (toFetchDepth2.length > 0) {
        log('fetching', toFetchDepth2.length, 'follow lists at depth 2');
        const limited = toFetchDepth2.slice(0, 500);
        await fetchFollowListsBatch(limited);
      }
    }
  } finally {
    socialGraphStore.setIsRecrawling(false);
  }
}

async function fetchFollowListsBatch(pubkeys: string[]): Promise<void> {
  if (pubkeys.length === 0) return;

  const batchSize = 100;
  const batchDelayMs = 500;

  for (let i = 0; i < pubkeys.length; i += batchSize) {
    const batch = pubkeys.slice(i, i + batchSize);
    log('fetching batch', i / batchSize + 1, 'of', Math.ceil(pubkeys.length / batchSize));

    try {
      const events = await ndk.fetchEvents({
        kinds: [KIND_CONTACTS],
        authors: batch,
      });

      const eventsArray: NostrEvent[] = [];
      for (const ev of events) {
        eventsArray.push(ev.rawEvent() as NostrEvent);
      }

      if (eventsArray.length > 0) {
        handleSocialGraphEvent(eventsArray);
      }

      if (i + batchSize < pubkeys.length) {
        await new Promise(r => setTimeout(r, batchDelayMs));
      }
    } catch (err) {
      console.error('[socialGraph] error fetching batch:', err);
    }
  }
}

async function setupSubscription(publicKey: string) {
  log('setting root to', publicKey);
  currentRoot = publicKey;
  await sendToWorker({ type: 'setRoot', pubkey: publicKey });

  await fetchFollowList(publicKey);
  queueMicrotask(() => crawlFollowLists(publicKey));

  sub?.stop();

  sub = ndk.subscribe(
    {
      kinds: [KIND_CONTACTS],
      authors: [publicKey],
      limit: 1,
    },
    { closeOnEose: false }
  );

  let latestTime = 0;
  sub.on('event', (ev: NDKEvent) => {
    if (typeof ev.created_at !== 'number' || ev.created_at < latestTime) {
      return;
    }
    latestTime = ev.created_at;
    handleSocialGraphEvent(ev.rawEvent() as NostrEvent);
    queueMicrotask(() => crawlFollowLists(publicKey, 1));
  });
}

export async function setupSocialGraphSubscriptions() {
  const currentPublicKey = get(nostrStore).pubkey;
  if (currentPublicKey) {
    await setupSubscription(currentPublicKey);
  }

  let prevPubkey = currentPublicKey;
  nostrStore.subscribe((state) => {
    if (state.pubkey !== prevPubkey) {
      if (state.pubkey) {
        setupSubscription(state.pubkey);
      } else {
        currentRoot = DEFAULT_SOCIAL_GRAPH_ROOT;
        sendToWorker({ type: 'setRoot', pubkey: DEFAULT_SOCIAL_GRAPH_ROOT }).catch(() => {});
      }
      prevPubkey = state.pubkey;
    }
  });
}

// ============================================================================
// Auto-initialize
// ============================================================================

queueMicrotask(() => {
  initializeSocialGraph()
    .then(() => {
      log('worker initialized');
      return setupSocialGraphSubscriptions();
    })
    .then(() => {
      log('subscriptions ready');
    })
    .catch((err) => {
      console.error('[socialGraph] initialization error:', err);
    });
});
