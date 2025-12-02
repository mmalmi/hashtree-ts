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
 * Returns entries (sorted: dirs first, then files) and whether it's actually a directory
 */
export function useDirectoryEntries(dirHash: Hash | null) {
  const [entries, setEntries] = useState<TreeEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [isDirectory, setIsDirectory] = useState(true);

  // Convert to hex string for stable comparison (Uint8Array reference changes on each render)
  const hashKey = dirHash ? toHex(dirHash) : null;

  useEffect(() => {
    if (!hashKey) {
      setEntries([]);
      setIsDirectory(true);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const tree = getTree();
    const hash = fromHex(hashKey);

    // First check if it's a directory
    tree.isDirectory(hash).then(isDir => {
      if (cancelled) return;
      setIsDirectory(isDir);

      if (isDir) {
        // It's a directory - list entries
        return tree.listDirectory(hash).then(list => {
          if (!cancelled) {
            setEntries(sortEntries(list));
            setLoading(false);
          }
        });
      } else {
        // It's a file - don't list entries (would show chunks)
        setEntries([]);
        setLoading(false);
      }
    }).catch(() => {
      if (!cancelled) {
        setEntries([]);
        setIsDirectory(true);
        setLoading(false);
      }
    });

    return () => { cancelled = true; };
  }, [hashKey]); // Use string key for stable comparison

  return { entries, loading, isDirectory };
}
