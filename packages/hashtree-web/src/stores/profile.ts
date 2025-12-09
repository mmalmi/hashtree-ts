import { writable, type Readable } from 'svelte/store';
import { nip19 } from 'nostr-tools';
import { LRUCache } from '../utils/lruCache';
import { ndk } from '../nostr';

export interface Profile {
  pubkey: string;
  name?: string;
  display_name?: string;
  username?: string;
  about?: string;
  picture?: string;
  nip05?: string;
  website?: string;
  banner?: string;
  lud16?: string;
}

// In-memory profile cache
const profileCache = new LRUCache<string, Profile>(200);

// Track in-flight fetches to avoid duplicates
const pendingFetches = new Set<string>();

// Event emitter for profile updates
type ProfileListener = (profile: Profile) => void;
const listeners = new Map<string, Set<ProfileListener>>();

function subscribe(pubkey: string, listener: ProfileListener): () => void {
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

function notifyListeners(pubkey: string, profile: Profile) {
  const set = listeners.get(pubkey);
  if (set) {
    set.forEach(fn => fn(profile));
  }
}

async function fetchProfile(pubkey: string): Promise<void> {
  // Skip if fetch already in progress
  if (pendingFetches.has(pubkey)) {
    console.log('[profile] fetch already in progress for', pubkey);
    return;
  }

  console.log('[profile] fetching profile for', pubkey);
  pendingFetches.add(pubkey);

  try {
    const events = await ndk.fetchEvents({ kinds: [0], authors: [pubkey], limit: 1 });
    console.log('[profile] got', events.size, 'events for', pubkey);

    if (events.size > 0) {
      // Get the most recent profile
      const eventsArray = Array.from(events);
      const event = eventsArray.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))[0];
      console.log('[profile] profile content:', event.content.slice(0, 100));
      try {
        const profile = JSON.parse(event.content) as Profile;
        profile.pubkey = event.pubkey;
        profileCache.set(pubkey, profile);
        notifyListeners(pubkey, profile);
      } catch (e) {
        console.error('[profile] JSON parse error', e);
      }
    }
  } catch (e) {
    console.error('[profile] fetch error', e);
  } finally {
    pendingFetches.delete(pubkey);
  }
}

/**
 * Create a Svelte store for a profile
 */
export function createProfileStore(pubkey: string | undefined): Readable<Profile | undefined> {
  const pubkeyHex = pubkey
    ? pubkey.startsWith('npub1')
      ? (() => {
          try {
            const decoded = nip19.decode(pubkey);
            return decoded.data as string;
          } catch {
            return '';
          }
        })()
      : pubkey
    : '';

  const store = writable<Profile | undefined>(pubkeyHex ? profileCache.get(pubkeyHex) : undefined);

  if (pubkeyHex) {
    // Subscribe to updates
    const unsubListener = subscribe(pubkeyHex, (profile) => {
      store.set(profile);
    });

    // Fetch if not cached
    if (!profileCache.get(pubkeyHex)) {
      fetchProfile(pubkeyHex);
    }

    return {
      subscribe: (run, invalidate) => {
        const unsubStore = store.subscribe(run, invalidate);
        return () => {
          unsubStore();
          unsubListener();
        };
      },
    };
  }

  return { subscribe: store.subscribe };
}

/**
 * Invalidate cached profile and refetch
 */
export function invalidateProfile(pubkey: string) {
  profileCache.delete(pubkey);
  pendingFetches.delete(pubkey);
  fetchProfile(pubkey);
}

/**
 * Get a name from profile, with fallback priority
 */
export function getProfileName(profile?: Profile, pubkey?: string): string | undefined {
  if (!profile && !pubkey) return undefined;

  if (profile) {
    return profile.display_name || profile.name || profile.username ||
           (profile.nip05 ? profile.nip05.split('@')[0] : undefined);
  }

  return undefined;
}

/**
 * Get cached profile synchronously (for non-reactive use)
 */
export function getProfileSync(pubkey: string): Profile | undefined {
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
  return profileCache.get(pubkeyHex);
}
