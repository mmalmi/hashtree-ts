/**
 * Hook to subscribe to a user's trees via RefResolver
 *
 * Replaces the old loadHashtrees approach with live subscription.
 */
import { useEffect, useState } from 'react';
import { getRefResolver } from '../refResolver';
import { toHex, type Hash } from 'hashtree';

export interface TreeEntry {
  key: string;      // "npub1.../treename"
  name: string;     // Just the tree name
  hash: Hash;       // Current root hash
  hashHex: string;  // Hex string of hash
}

/**
 * Subscribe to trees for an npub
 * Returns live-updating list of trees
 */
export function useTrees(npub: string | null): TreeEntry[] {
  const [trees, setTrees] = useState<TreeEntry[]>([]);

  useEffect(() => {
    if (!npub) {
      setTrees([]);
      return;
    }

    const resolver = getRefResolver();
    if (!resolver.list) {
      return;
    }

    const unsubscribe = resolver.list(npub, (entries) => {
      setTrees(entries.map(e => ({
        key: e.key,
        name: e.key.split('/')[1] || '',
        hash: e.hash,
        hashHex: toHex(e.hash),
      })));
    });

    return unsubscribe;
  }, [npub]);

  return trees;
}
