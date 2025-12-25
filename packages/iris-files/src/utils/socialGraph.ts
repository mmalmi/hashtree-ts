/**
 * Social Graph integration using Unified Worker
 * Provides follow distance calculations and trust indicators
 * Heavy operations happen in worker, main thread keeps sync cache for UI
 */
import { writable, get } from 'svelte/store';
import { getWorkerAdapter } from '../workerAdapter';
import { nostrStore } from '../nostr';

// Default root pubkey (used when not logged in)
const DEFAULT_SOCIAL_GRAPH_ROOT = '4523be58d395b1b196a9b8c82b038b6895cb02b683d0c253a955068dba1facd0';

// Debug logging
const DEBUG = false;
const log = (...args: unknown[]) => DEBUG && console.log('[socialGraph]', ...args);

// ============================================================================
// Sync Caches (for immediate UI access)
// ============================================================================

const followDistanceCache = new Map<string, number>();
const isFollowingCache = new Map<string, boolean>();
const followsCache = new Map<string, Set<string>>();
const followersCache = new Map<string, Set<string>>();

function clearCaches() {
  followDistanceCache.clear();
  isFollowingCache.clear();
  followsCache.clear();
  followersCache.clear();
}

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
      clearCaches();
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
// Version callback setup (called after worker ready)
// ============================================================================

export function setupVersionCallback() {
  const adapter = getWorkerAdapter();
  if (adapter) {
    adapter.onSocialGraphVersion((version) => {
      socialGraphStore.setVersion(version);
      // Clear caches on version update
      clearCaches();
    });
  }
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
  const adapter = getWorkerAdapter();
  if (adapter) {
    adapter.getFollowDistance(pubkey)
      .then(d => {
        followDistanceCache.set(pubkey, d);
        socialGraphStore.incrementVersion();
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
  const adapter = getWorkerAdapter();
  if (adapter) {
    adapter.isFollowing(follower, followedUser)
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
  const adapter = getWorkerAdapter();
  if (adapter) {
    adapter.getFollows(pubkey)
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
  const adapter = getWorkerAdapter();
  if (adapter) {
    adapter.getFollowers(pubkey)
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

  const cached = followersCache.get(pubkey);
  if (cached) return cached;

  const adapter = getWorkerAdapter();
  if (adapter) {
    adapter.getFollowedByFriends(pubkey)
      .then(arr => {
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

// Cached graph size (updated async)
let graphSizeCache = 0;

/**
 * Get the graph size
 */
export function getGraphSize(): number {
  // Trigger async fetch to update cache
  const adapter = getWorkerAdapter();
  if (adapter) {
    adapter.getSocialGraphSize()
      .then(size => {
        if (size !== graphSizeCache) {
          graphSizeCache = size;
          socialGraphStore.incrementVersion();
        }
      })
      .catch(() => {});
  }
  return graphSizeCache;
}

/**
 * Get users at a specific follow distance
 */
export function getUsersByFollowDistance(_distance: number): Set<string> {
  // This is rarely used in hot paths, return empty and let caller handle async if needed
  return new Set();
}

// Legacy aliases
export const followDistance = getFollowDistance;
export const followedByFriends = getFollowedByFriends;
export const follows = getFollows;

// Mock SocialGraph interface for backwards compatibility (e2e tests)
export function getSocialGraph(): { getRoot: () => string } | null {
  return {
    getRoot: () => get(nostrStore).pubkey || DEFAULT_SOCIAL_GRAPH_ROOT,
  };
}

// ============================================================================
// Subscription Management
// ============================================================================

export async function fetchFollowList(publicKey: string): Promise<void> {
  log('fetching own follow list for', publicKey);
  // The worker's NDK subscription handles kind:3 events automatically
  // This function is kept for API compatibility but is now a no-op
}

async function crawlFollowLists(publicKey: string, depth = 2): Promise<void> {
  if (depth <= 0) return;

  const adapter = getWorkerAdapter();
  if (!adapter) return;

  socialGraphStore.setIsRecrawling(true);

  try {
    // Get current follows to check
    const rootFollows = await adapter.getFollows(publicKey);

    // Find users we need to fetch follow lists for
    const toFetch: string[] = [];
    for (const pk of rootFollows) {
      const theirFollows = await adapter.getFollows(pk);
      if (theirFollows.length === 0) {
        toFetch.push(pk);
      }
    }

    log('need to crawl', toFetch.length, 'users at depth 1');

    // Depth 2
    if (depth >= 2) {
      const toFetchSet = new Set(toFetch);

      for (const pk of rootFollows) {
        const theirFollows = await adapter.getFollows(pk);
        for (const pk2 of theirFollows) {
          if (!toFetchSet.has(pk2)) {
            const followsOfFollows = await adapter.getFollows(pk2);
            if (followsOfFollows.length === 0) {
              toFetchSet.add(pk2);
            }
          }
        }
      }

      log('total users needing crawl:', toFetchSet.size);
    }

    // Note: The worker's NDK subscription will fetch kind:3 events
    // We just identified who needs fetching here
  } finally {
    socialGraphStore.setIsRecrawling(false);
  }
}

async function setupSubscription(publicKey: string) {
  log('setting root to', publicKey);
  currentRoot = publicKey;

  const adapter = getWorkerAdapter();
  if (!adapter) return;

  try {
    await adapter.setSocialGraphRoot(publicKey);
  } catch (err) {
    console.error('[socialGraph] error setting root:', err);
  }

  // Trigger crawl in background
  queueMicrotask(() => crawlFollowLists(publicKey));
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
        getWorkerAdapter()?.setSocialGraphRoot(DEFAULT_SOCIAL_GRAPH_ROOT).catch(() => {});
      }
      prevPubkey = state.pubkey;
    }
  });
}

// Worker handles SocialGraph init and kind:3 subscriptions internally
// App waits for restoreSession() before mounting, so worker is ready
