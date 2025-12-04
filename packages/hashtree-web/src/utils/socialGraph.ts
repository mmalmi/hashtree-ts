/**
 * Social Graph integration using nostr-social-graph
 * Provides follow distance calculations and trust indicators for avatars
 * Persisted to Dexie for non-blocking load
 */
import { create } from 'zustand';
import { SocialGraph, type NostrEvent } from 'nostr-social-graph';
import Dexie, { type Table } from 'dexie';
import { ndk, useNostrStore } from '../nostr';
import type { NDKEvent, NDKSubscription } from '@nostr-dev-kit/ndk';

// Default root pubkey (used when not logged in)
const DEFAULT_SOCIAL_GRAPH_ROOT = '4523be58d395b1b196a9b8c82b038b6895cb02b683d0c253a955068dba1facd0';
const KIND_CONTACTS = 3;
const DEFAULT_CRAWL_DEPTH = 2; // Crawl follows of follows

// Debug logging
const DEBUG = false;
const log = (...args: unknown[]) => DEBUG && console.log('[socialGraph]', ...args);

// Dexie database for social graph persistence
class SocialGraphDB extends Dexie {
  socialGraph!: Table<{ key: string; data: Uint8Array; updatedAt: number }>;

  constructor() {
    super('hashtree-social-graph');
    this.version(1).stores({
      socialGraph: '&key',
    });
  }
}

const db = new SocialGraphDB();

// Social graph instance
let instance: SocialGraph;
let isInitialized = false;
let isLoaded = false;
let resolveLoaded: ((value: boolean) => void) | null = null;

// Promise that resolves when graph is loaded
export const socialGraphLoaded = new Promise<boolean>((resolve) => {
  resolveLoaded = resolve;
});

// Zustand store for reactive updates
interface SocialGraphState {
  version: number;
  isRecrawling: boolean;
  incrementVersion: () => void;
  setIsRecrawling: (value: boolean) => void;
}

export const useSocialGraphStore = create<SocialGraphState>((set) => ({
  version: 0,
  isRecrawling: false,
  incrementVersion: () => set((state) => ({ version: state.version + 1 })),
  setIsRecrawling: (value) => set({ isRecrawling: value }),
}));

function notifyGraphChange() {
  useSocialGraphStore.getState().incrementVersion();
}

/**
 * Load social graph from Dexie
 */
async function loadFromDexie(publicKey: string): Promise<SocialGraph | null> {
  try {
    const stored = await db.socialGraph.get('main');
    if (stored?.data) {
      const graph = await SocialGraph.fromBinary(publicKey, stored.data);
      log('loaded from dexie, size:', graph.size());
      return graph;
    }
  } catch (err) {
    console.error('[socialGraph] error loading from dexie:', err);
    await db.socialGraph.delete('main');
  }
  return null;
}

/**
 * Save social graph to Dexie (throttled)
 */
let saveTimeout: ReturnType<typeof setTimeout> | null = null;
const SAVE_THROTTLE_MS = 15000;

function scheduleSave() {
  if (saveTimeout) return;
  saveTimeout = setTimeout(async () => {
    saveTimeout = null;
    if (!isInitialized || !instance) return;
    try {
      const data = await instance.toBinary();
      await db.socialGraph.put({
        key: 'main',
        data,
        updatedAt: Date.now(),
      });
      log('saved to dexie, size:', instance.size());
    } catch (err) {
      console.error('[socialGraph] error saving to dexie:', err);
    }
  }, SAVE_THROTTLE_MS);
}

/**
 * Initialize the social graph instance
 */
async function initializeInstance(publicKey = DEFAULT_SOCIAL_GRAPH_ROOT) {
  if (isInitialized) {
    log('setting root:', publicKey);
    instance.setRoot(publicKey);
    notifyGraphChange();
    return;
  }
  isInitialized = true;

  // Try to load from Dexie first
  const loaded = await loadFromDexie(publicKey);
  if (loaded) {
    instance = loaded;
  } else {
    // Create new empty graph
    log('creating new graph with root:', publicKey);
    instance = new SocialGraph(publicKey);
  }
  notifyGraphChange();
}

/**
 * Initialize social graph (call on app startup)
 */
export async function initializeSocialGraph() {
  const currentPublicKey = useNostrStore.getState().pubkey;
  await initializeInstance(currentPublicKey || undefined);

  if (!currentPublicKey) {
    instance.setRoot(DEFAULT_SOCIAL_GRAPH_ROOT);
  }

  isLoaded = true;
  resolveLoaded?.(true);
}

/**
 * Handle social graph events (kind 3 contact lists)
 */
export function handleSocialGraphEvent(evs: NostrEvent | NostrEvent[]) {
  if (!instance) return;

  instance.handleEvent(evs);
  scheduleSave();

  const events = Array.isArray(evs) ? evs : [evs];
  const hasFollowListUpdate = events.some((e) => e.kind === KIND_CONTACTS);

  if (hasFollowListUpdate) {
    notifyGraphChange();
  }
}

/**
 * Get the social graph instance
 */
export function getSocialGraph(): SocialGraph {
  return instance;
}

// Subscription for follow lists
let sub: NDKSubscription | null = null;

/**
 * Fetch our own follow list first, then crawl follows
 */
async function fetchOwnFollowList(publicKey: string): Promise<void> {
  log('fetching own follow list for', publicKey);

  const events = await ndk.fetchEvents({
    kinds: [KIND_CONTACTS],
    authors: [publicKey],
    limit: 1,
  });

  for (const ev of events) {
    handleSocialGraphEvent(ev.rawEvent() as NostrEvent);
  }

  await instance.recalculateFollowDistances();
  notifyGraphChange();
}

/**
 * Crawl follow lists starting from a user, up to specified depth
 */
async function crawlFollowLists(publicKey: string, depth = DEFAULT_CRAWL_DEPTH): Promise<void> {
  if (depth <= 0) return;

  const store = useSocialGraphStore.getState();
  store.setIsRecrawling(true);

  try {
    // Get users at current depth that we need to fetch
    const toFetch = new Set<string>();

    // Start with the root user's follows
    const rootFollows = instance.getFollowedByUser(publicKey);
    for (const pk of rootFollows) {
      const theirFollows = instance.getFollowedByUser(pk);
      if (theirFollows.size === 0) {
        toFetch.add(pk);
      }
    }

    if (toFetch.size === 0) {
      log('no missing follow lists at depth 1');
    } else {
      log('fetching', toFetch.size, 'follow lists at depth 1');
      await fetchFollowListsBatch(Array.from(toFetch));
    }

    // If we want depth 2, also fetch follows of follows
    if (depth >= 2) {
      const toFetchDepth2 = new Set<string>();
      for (const pk of rootFollows) {
        const theirFollows = instance.getFollowedByUser(pk);
        for (const pk2 of theirFollows) {
          const followsOfFollows = instance.getFollowedByUser(pk2);
          if (followsOfFollows.size === 0 && !toFetch.has(pk2)) {
            toFetchDepth2.add(pk2);
          }
        }
      }

      if (toFetchDepth2.size > 0) {
        log('fetching', toFetchDepth2.size, 'follow lists at depth 2');
        // Limit depth 2 to avoid too many requests
        const limited = Array.from(toFetchDepth2).slice(0, 500);
        await fetchFollowListsBatch(limited);
      }
    }

    await instance.recalculateFollowDistances();
    notifyGraphChange();
    scheduleSave();
  } finally {
    store.setIsRecrawling(false);
  }
}

/**
 * Fetch follow lists for a batch of pubkeys
 */
async function fetchFollowListsBatch(pubkeys: string[]): Promise<void> {
  if (pubkeys.length === 0) return;

  const batchSize = 100;
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
        instance.handleEvent(eventsArray);
        notifyGraphChange();
      }
    } catch (err) {
      console.error('[socialGraph] error fetching batch:', err);
    }
  }
}

/**
 * Setup subscriptions to crawl follow lists
 */
async function setupSubscription(publicKey: string) {
  instance.setRoot(publicKey);

  // First, fetch our own follow list
  await fetchOwnFollowList(publicKey);

  // Then crawl follows in the background
  queueMicrotask(() => crawlFollowLists(publicKey));

  sub?.stop();

  // Subscribe to live updates of our follow list
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

    // Re-crawl when our follow list updates
    queueMicrotask(() => crawlFollowLists(publicKey, 1));
    instance.recalculateFollowDistances().then(() => notifyGraphChange());
  });
}

/**
 * Setup social graph subscriptions (call after initialization)
 */
export async function setupSocialGraphSubscriptions() {
  const currentPublicKey = useNostrStore.getState().pubkey;
  if (currentPublicKey) {
    await setupSubscription(currentPublicKey);
  }

  // Subscribe to public key changes
  useNostrStore.subscribe((state, prevState) => {
    if (state.pubkey !== prevState.pubkey) {
      if (state.pubkey) {
        setupSubscription(state.pubkey);
      } else {
        instance.setRoot(DEFAULT_SOCIAL_GRAPH_ROOT);
        notifyGraphChange();
      }
    }
  });
}

// React hooks for components

/**
 * Hook to get the social graph instance (reactive)
 */
export function useSocialGraph(): SocialGraph {
  useSocialGraphStore((state) => state.version);
  return instance;
}

/**
 * Hook to get follow distance for a pubkey
 */
export function useFollowDistance(pubkey: string | null | undefined): number {
  useSocialGraphStore((state) => state.version);
  if (!pubkey || !instance) return 1000;
  return instance.getFollowDistance(pubkey);
}

/**
 * Hook to check if one user follows another
 */
export function useIsFollowing(
  follower: string | null | undefined,
  followedUser: string | null | undefined
): boolean {
  useSocialGraphStore((state) => state.version);
  if (!follower || !followedUser || !instance) return false;
  return instance.isFollowing(follower, followedUser);
}

/**
 * Hook to get users who follow a given pubkey (from friends)
 */
export function useFollowedByFriends(pubkey: string | null | undefined): Set<string> {
  useSocialGraphStore((state) => state.version);
  if (!pubkey || !instance) return new Set();
  return instance.followedByFriends(pubkey);
}

/**
 * Hook to check if a user follows the current logged-in user
 */
export function useFollowsMe(pubkey: string | null | undefined): boolean {
  useSocialGraphStore((state) => state.version);
  const myPubkey = useNostrStore.getState().pubkey;
  if (!pubkey || !myPubkey || !instance) return false;
  return instance.isFollowing(pubkey, myPubkey);
}

/**
 * Hook to get followers of a user (known from the graph)
 */
export function useFollowers(pubkey: string | null | undefined): Set<string> {
  useSocialGraphStore((state) => state.version);
  if (!pubkey || !instance) return new Set();
  return instance.getFollowersByUser(pubkey);
}

/**
 * Hook to get users followed by a user
 */
export function useFollows(pubkey: string | null | undefined): Set<string> {
  useSocialGraphStore((state) => state.version);
  if (!pubkey || !instance) return new Set();
  return instance.getFollowedByUser(pubkey);
}

/**
 * Hook to get the graph size
 */
export function useGraphSize(): number {
  useSocialGraphStore((state) => state.version);
  if (!instance) return 0;
  return instance.size();
}

/**
 * Hook to check if the graph is currently recrawling
 */
export function useIsRecrawling(): boolean {
  return useSocialGraphStore((state) => state.isRecrawling);
}

// Initialize on module load (non-blocking)
initializeSocialGraph()
  .then(() => {
    log('initialized');
    return setupSocialGraphSubscriptions();
  })
  .then(() => {
    log('subscriptions ready');
  })
  .catch((err) => {
    console.error('[socialGraph] initialization error:', err);
  });
