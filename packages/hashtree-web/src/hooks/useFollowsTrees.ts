/**
 * Hook to get trees from followed users with live subscriptions
 * Includes both direct follows (distance 1) and 2nd degree follows (distance 2)
 */
import { useState, useEffect, useRef } from 'react';
import { nip19 } from 'nostr-tools';
import type { NDKSubscription } from '@nostr-dev-kit/ndk';
import { ndk, useNostrStore, type HashTreeEvent, parseVisibility } from '../nostr';
import { getUsersByFollowDistance, useSocialGraphStore } from '../utils/socialGraph';

export interface FollowedTree extends HashTreeEvent {
  npub: string;
  /** Follow distance: 1 = direct follow, 2 = follow of follow */
  distance: number;
}

/**
 * Subscribe to trees from followed users (1st and 2nd degree)
 */
export function useFollowsTrees(): {
  trees: FollowedTree[];
  loading: boolean;
  followsCount: number;
  secondDegreeCount: number;
} {
  const myPubkey = useNostrStore(s => s.pubkey);
  // Subscribe to social graph changes to pick up 2nd degree follows
  const graphVersion = useSocialGraphStore(s => s.version);
  const [trees, setTrees] = useState<FollowedTree[]>([]);
  const [loading, setLoading] = useState(false);
  const [followsCount, setFollowsCount] = useState(0);
  const [secondDegreeCount, setSecondDegreeCount] = useState(0);
  const followedPubkeysRef = useRef<Set<string>>(new Set());
  const allPubkeysRef = useRef<Set<string>>(new Set());
  const treesSubRef = useRef<NDKSubscription | null>(null);

  useEffect(() => {
    if (!myPubkey) {
      setTrees([]);
      return;
    }

    let cancelled = false;
    setLoading(true);

    // Map to track latest tree per pubkey+name
    const latestByKey = new Map<string, FollowedTree>();

    // Track which pubkeys are direct follows vs 2nd degree
    const directFollows = new Set<string>();

    const updateTrees = () => {
      const sortedTrees = Array.from(latestByKey.values())
        .sort((a, b) => {
          // Sort by distance first (1st degree before 2nd), then by date
          if (a.distance !== b.distance) return a.distance - b.distance;
          return b.created_at - a.created_at;
        });
      setTrees(sortedTrees);
    };

    const processTreeEvent = (event: { id: string; pubkey: string; tags: string[][]; content: string; created_at?: number }) => {
      const dTag = event.tags.find(t => t[0] === 'd')?.[1];
      if (!dTag) return;

      // Read hash and optional key from tags
      const rootHash = event.tags.find(t => t[0] === 'hash')?.[1];
      if (!rootHash) return;

      // Parse visibility info
      const visInfo = parseVisibility(event.tags);

      // Determine follow distance
      const distance = directFollows.has(event.pubkey) ? 1 : 2;

      const key = `${event.pubkey}:${dTag}`;
      const existing = latestByKey.get(key);

      if (!existing || (event.created_at || 0) > existing.created_at) {
        latestByKey.set(key, {
          id: event.id,
          pubkey: event.pubkey,
          npub: nip19.npubEncode(event.pubkey),
          name: dTag,
          rootHash,
          rootKey: visInfo.rootKey,
          visibility: visInfo.visibility,
          encryptedKey: visInfo.encryptedKey,
          keyId: visInfo.keyId,
          selfEncryptedKey: visInfo.selfEncryptedKey,
          created_at: event.created_at || 0,
          distance,
        });
        updateTrees();
      }
    };

    const startTreesSub = (pubkeys: string[]) => {
      if (pubkeys.length === 0) {
        setLoading(false);
        return;
      }

      // Close existing trees subscription
      if (treesSubRef.current) {
        treesSubRef.current.stop();
        treesSubRef.current = null;
      }

      // Clear existing trees when follows change
      latestByKey.clear();

      const treesSub = ndk.subscribe({
        kinds: [30078],
        authors: pubkeys,
        '#l': ['hashtree'],
      }, { closeOnEose: false });

      treesSub.on('event', (event) => {
        if (cancelled) return;
        processTreeEvent(event);
      });

      treesSub.on('eose', () => {
        if (!cancelled) {
          setLoading(false);
        }
      });

      treesSubRef.current = treesSub;
    };

    const updateSubscription = (firstDegree: string[], secondDegree: string[]) => {
      // Update direct follows set for distance calculation
      directFollows.clear();
      for (const pk of firstDegree) {
        directFollows.add(pk);
      }

      // Combine 1st and 2nd degree (excluding self)
      const allPubkeys = new Set([...firstDegree, ...secondDegree]);
      allPubkeys.delete(myPubkey);

      // Check if the set changed
      const prevAll = allPubkeysRef.current;
      const changed = allPubkeys.size !== prevAll.size ||
        [...allPubkeys].some(p => !prevAll.has(p));

      if (changed) {
        allPubkeysRef.current = allPubkeys;
        setFollowsCount(firstDegree.length);
        setSecondDegreeCount(secondDegree.filter(p => !directFollows.has(p) && p !== myPubkey).length);
        startTreesSub(Array.from(allPubkeys));
      }
    };

    // Subscribe to my follows list
    const followsSub = ndk.subscribe({
      kinds: [3],
      authors: [myPubkey],
    }, { closeOnEose: false });

    followsSub.on('event', (event) => {
      if (cancelled) return;

      const firstDegree = event.tags
        .filter(t => t[0] === 'p' && t[1])
        .map(t => t[1]);

      followedPubkeysRef.current = new Set(firstDegree);

      // Get 2nd degree from social graph
      const secondDegree = Array.from(getUsersByFollowDistance(2));

      updateSubscription(firstDegree, secondDegree);
    });

    followsSub.on('eose', () => {
      if (!cancelled && followedPubkeysRef.current.size === 0) {
        // No direct follows yet, but we might have 2nd degree from graph
        const secondDegree = Array.from(getUsersByFollowDistance(2));
        if (secondDegree.length > 0) {
          updateSubscription([], secondDegree);
        } else {
          setLoading(false);
        }
      }
    });

    return () => {
      cancelled = true;
      followsSub.stop();
      if (treesSubRef.current) {
        treesSubRef.current.stop();
        treesSubRef.current = null;
      }
    };
  }, [myPubkey, graphVersion]);

  return { trees, loading, followsCount, secondDegreeCount };
}
