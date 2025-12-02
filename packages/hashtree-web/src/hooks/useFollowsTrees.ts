/**
 * Hook to get trees from followed users with live subscriptions
 */
import { useState, useEffect, useRef } from 'react';
import { nip19 } from 'nostr-tools';
import type { NDKSubscription } from '@nostr-dev-kit/ndk';
import { ndk, useNostrStore, type HashTreeEvent } from '../nostr';

export interface FollowedTree extends HashTreeEvent {
  npub: string;
}

/**
 * Subscribe to trees from all followed users
 */
export function useFollowsTrees(): { trees: FollowedTree[]; loading: boolean; followsCount: number } {
  const myPubkey = useNostrStore(s => s.pubkey);
  const [trees, setTrees] = useState<FollowedTree[]>([]);
  const [loading, setLoading] = useState(false);
  const [followsCount, setFollowsCount] = useState(0);
  const followedPubkeysRef = useRef<string[]>([]);
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

    const updateTrees = () => {
      const sortedTrees = Array.from(latestByKey.values())
        .sort((a, b) => b.created_at - a.created_at);
      setTrees(sortedTrees);
    };

    const processTreeEvent = (event: { id: string; pubkey: string; tags: string[][]; content: string; created_at?: number }) => {
      const dTag = event.tags.find(t => t[0] === 'd')?.[1];
      if (!dTag || !event.content) return;

      const key = `${event.pubkey}:${dTag}`;
      const existing = latestByKey.get(key);

      if (!existing || (event.created_at || 0) > existing.created_at) {
        latestByKey.set(key, {
          id: event.id,
          pubkey: event.pubkey,
          npub: nip19.npubEncode(event.pubkey),
          name: dTag,
          rootHash: event.content,
          created_at: event.created_at || 0,
        });
        updateTrees();
      }
    };

    const startTreesSub = (pubkeys: string[]) => {
      if (pubkeys.length === 0) return;

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

    // Subscribe to my follows list
    const followsSub = ndk.subscribe({
      kinds: [3],
      authors: [myPubkey],
    }, { closeOnEose: false });

    followsSub.on('event', (event) => {
      if (cancelled) return;

      const pubkeys = event.tags
        .filter(t => t[0] === 'p' && t[1])
        .map(t => t[1]);

      // Check if follows list changed
      const prevPubkeys = followedPubkeysRef.current;
      const changed = pubkeys.length !== prevPubkeys.length ||
        pubkeys.some((p, i) => p !== prevPubkeys[i]);

      if (changed) {
        followedPubkeysRef.current = pubkeys;
        setFollowsCount(pubkeys.length);
        startTreesSub(pubkeys);
      }
    });

    followsSub.on('eose', () => {
      if (!cancelled && followedPubkeysRef.current.length === 0) {
        setLoading(false);
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
  }, [myPubkey]);

  return { trees, loading, followsCount };
}
