/**
 * follows hook - manages follow lists and follow/unfollow actions
 * Svelte version using writable stores
 */
import { writable, get } from 'svelte/store';
import { nip19 } from 'nostr-tools';
import { NDKEvent } from '@nostr-dev-kit/ndk';
import { LRUCache } from '../utils/lruCache';
import { ndk, nostrStore } from '../nostr';
import { handleSocialGraphEvent } from '../utils/socialGraph';

export interface Follows {
  pubkey: string;
  follows: string[];
  followedAt: number;
}

// Cache follows lists
const followsCache = new LRUCache<string, Follows>(100);
const pendingFetches = new Set<string>();

// Event listeners for reactive updates
type FollowsListener = (follows: Follows) => void;
const listeners = new Map<string, Set<FollowsListener>>();

function subscribe(pubkey: string, listener: FollowsListener): () => void {
  let set = listeners.get(pubkey);
  if (!set) {
    set = new Set();
    listeners.set(pubkey, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) listeners.delete(pubkey);
  };
}

function notifyListeners(pubkey: string, follows: Follows) {
  const set = listeners.get(pubkey);
  if (set) {
    set.forEach(fn => fn(follows));
  }
}

async function fetchFollows(pubkey: string): Promise<void> {
  if (pendingFetches.has(pubkey)) return;

  pendingFetches.add(pubkey);

  try {
    const events = await ndk.fetchEvents({ kinds: [3], authors: [pubkey], limit: 1 });

    if (events.size > 0) {
      const eventsArray = Array.from(events);
      const event = eventsArray.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))[0];
      const followPubkeys = event.tags
        .filter(t => t[0] === 'p' && t[1])
        .map(t => t[1]);

      const follows: Follows = {
        pubkey: event.pubkey,
        follows: followPubkeys,
        followedAt: event.created_at || 0,
      };
      followsCache.set(pubkey, follows);
      notifyListeners(pubkey, follows);
    } else {
      // No follows found - store empty
      const follows: Follows = { pubkey, follows: [], followedAt: 0 };
      followsCache.set(pubkey, follows);
      notifyListeners(pubkey, follows);
    }
  } catch (e) {
    console.error('[follows] fetch error', e);
  } finally {
    pendingFetches.delete(pubkey);
  }
}

/**
 * Create a Svelte store for a user's follows list
 */
export function createFollowsStore(pubkey?: string) {
  const pubkeyHex = pubkey?.startsWith('npub1')
    ? (() => {
        try {
          const decoded = nip19.decode(pubkey);
          return decoded.data as string;
        } catch {
          return '';
        }
      })()
    : pubkey || '';

  const { subscribe: storeSubscribe, set } = writable<Follows | undefined>(
    pubkeyHex ? followsCache.get(pubkeyHex) : undefined
  );

  if (pubkeyHex) {
    // Subscribe to updates
    const unsub = subscribe(pubkeyHex, set);

    // Fetch if not cached
    const cached = followsCache.get(pubkeyHex);
    if (cached) {
      set(cached);
    } else {
      fetchFollows(pubkeyHex);
    }

    // Return store with cleanup
    return {
      subscribe: storeSubscribe,
      destroy: unsub,
    };
  }

  return {
    subscribe: storeSubscribe,
    destroy: () => {},
  };
}

/**
 * Get follows synchronously (from cache)
 */
export function getFollowsSync(pubkey?: string): Follows | undefined {
  if (!pubkey) return undefined;
  const pubkeyHex = pubkey.startsWith('npub1')
    ? (() => {
        try {
          const decoded = nip19.decode(pubkey);
          return decoded.data as string;
        } catch {
          return '';
        }
      })()
    : pubkey;
  return followsCache.get(pubkeyHex);
}

/**
 * Follow a pubkey - publishes kind 3 event with updated follow list
 */
export async function followPubkey(targetPubkey: string): Promise<boolean> {
  const pk = get(nostrStore).pubkey;
  if (!pk || !ndk.signer) return false;

  // Get current follows
  let currentFollows = followsCache.get(pk);
  if (!currentFollows) {
    await fetchFollows(pk);
    currentFollows = followsCache.get(pk);
  }

  const follows = currentFollows?.follows || [];
  if (follows.includes(targetPubkey)) return true; // Already following

  const newFollows = [...follows, targetPubkey];
  return publishFollowList(pk, newFollows);
}

/**
 * Unfollow a pubkey - publishes kind 3 event with updated follow list
 */
export async function unfollowPubkey(targetPubkey: string): Promise<boolean> {
  const pk = get(nostrStore).pubkey;
  if (!pk || !ndk.signer) return false;

  // Get current follows
  let currentFollows = followsCache.get(pk);
  if (!currentFollows) {
    await fetchFollows(pk);
    currentFollows = followsCache.get(pk);
  }

  const follows = currentFollows?.follows || [];
  if (!follows.includes(targetPubkey)) return true; // Already not following

  const newFollows = follows.filter(p => p !== targetPubkey);
  return publishFollowList(pk, newFollows);
}

async function publishFollowList(pk: string, follows: string[]): Promise<boolean> {
  try {
    const event = new NDKEvent(ndk);
    event.kind = 3;
    event.content = '';
    event.tags = follows.map(p => ['p', p]);

    await event.publish();

    // Update cache
    const newFollows: Follows = {
      pubkey: pk,
      follows,
      followedAt: event.created_at || Math.floor(Date.now() / 1000),
    };
    followsCache.set(pk, newFollows);
    notifyListeners(pk, newFollows);

    // Update social graph
    handleSocialGraphEvent(event.rawEvent() as any);

    return true;
  } catch (e) {
    console.error('[follows] publish error', e);
    return false;
  }
}

/**
 * Invalidate cache for a pubkey (force refetch)
 */
export function invalidateFollows(pubkey: string): void {
  followsCache.delete(pubkey);
  fetchFollows(pubkey);
}
