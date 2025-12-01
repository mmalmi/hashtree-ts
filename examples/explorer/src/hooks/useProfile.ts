import { useEffect, useMemo, useState, useCallback } from 'react';
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
    console.log('[useProfile] fetch already in progress for', pubkey);
    return;
  }

  console.log('[useProfile] fetching profile for', pubkey);
  pendingFetches.add(pubkey);

  try {
    const events = await ndk.fetchEvents({ kinds: [0], authors: [pubkey], limit: 1 });
    console.log('[useProfile] got', events.size, 'events for', pubkey);

    if (events.size > 0) {
      // Get the most recent profile
      const eventsArray = Array.from(events);
      const event = eventsArray.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))[0];
      console.log('[useProfile] profile content:', event.content.slice(0, 100));
      try {
        const profile = JSON.parse(event.content) as Profile;
        profile.pubkey = event.pubkey;
        profileCache.set(pubkey, profile);
        notifyListeners(pubkey, profile);
      } catch (e) {
        console.error('[useProfile] JSON parse error', e);
      }
    }
  } catch (e) {
    console.error('[useProfile] fetch error', e);
  } finally {
    pendingFetches.delete(pubkey);
  }
}

/**
 * Hook to fetch and cache a nostr profile
 */
export function useProfile(pubkey?: string): Profile | undefined {
  const pubkeyHex = useMemo(() => {
    if (!pubkey) return '';
    if (pubkey.startsWith('npub1')) {
      try {
        const decoded = nip19.decode(pubkey);
        console.log('[useProfile] decoded npub to hex:', decoded.data);
        return decoded.data as string;
      } catch (e) {
        console.error('[useProfile] failed to decode npub:', e);
        return '';
      }
    }
    console.log('[useProfile] using hex pubkey:', pubkey);
    return pubkey;
  }, [pubkey]);

  const [profile, setProfile] = useState<Profile | undefined>(() =>
    pubkeyHex ? profileCache.get(pubkeyHex) : undefined
  );

  const handleProfileUpdate = useCallback((p: Profile) => {
    setProfile(p);
  }, []);

  useEffect(() => {
    if (!pubkeyHex) {
      setProfile(undefined);
      return;
    }

    // Check cache first
    const cached = profileCache.get(pubkeyHex);
    if (cached) {
      setProfile(cached);
    }

    // Always subscribe to updates (for cache invalidation/refetch)
    const unsub = subscribe(pubkeyHex, handleProfileUpdate);

    // Trigger fetch if not cached
    if (!cached) {
      fetchProfile(pubkeyHex);
    }

    return unsub;
  }, [pubkeyHex, handleProfileUpdate]);

  return profile;
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
