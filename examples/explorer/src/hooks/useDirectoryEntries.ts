/**
 * Hook to fetch directory entries from tree
 * Simple - just reads from tree, no caching or global state
 */
import { useState, useEffect } from 'react';
import { type Hash, type TreeEntry, toHex, fromHex } from 'hashtree';
import { getTree } from '../store';

// Sort entries: directories first, then alphabetically
function sortEntries(entries: TreeEntry[]): TreeEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isTree !== b.isTree) return a.isTree ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Fetch directory entries for a given hash
 * Returns entries (sorted: dirs first, then files)
 */
export function useDirectoryEntries(dirHash: Hash | null) {
  const [entries, setEntries] = useState<TreeEntry[]>([]);
  const [loading, setLoading] = useState(false);

  // Convert to hex string for stable comparison (Uint8Array reference changes on each render)
  const hashKey = dirHash ? toHex(dirHash) : null;

  useEffect(() => {
    if (!hashKey) {
      setEntries([]);
      return;
    }

    let cancelled = false;
    setLoading(true);

    getTree().listDirectory(fromHex(hashKey)).then(list => {
      if (!cancelled) {
        setEntries(sortEntries(list));
        setLoading(false);
      }
    }).catch(() => {
      if (!cancelled) {
        setEntries([]);
        setLoading(false);
      }
    });

    return () => { cancelled = true; };
  }, [hashKey]); // Use string key for stable comparison

  return { entries, loading };
}
