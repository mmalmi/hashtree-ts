/**
 * Hook to fetch directory entries from tree
 * Simple - just reads from tree, no caching or global state
 * Supports both encrypted and public directories via CID
 */
import { useState, useEffect } from 'react';
import { type CID, type TreeEntry, toHex } from 'hashtree';
import { getTree } from '../store';

// Sort entries: directories first, then alphabetically
function sortEntries(entries: TreeEntry[]): TreeEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isTree !== b.isTree) return a.isTree ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Fetch directory entries for a given CID (hash + optional key)
 * Returns entries (sorted: dirs first, then files) and whether it's actually a directory
 */
export function useDirectoryEntries(location: CID | null) {
  const [entries, setEntries] = useState<TreeEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [isDirectory, setIsDirectory] = useState(true);

  // Convert to hex strings for stable comparison (Uint8Array reference changes on each render)
  const hashKey = location?.hash ? toHex(location.hash) : null;
  const encKey = location?.key ? toHex(location.key) : null;

  useEffect(() => {
    if (!location || !hashKey) {
      setEntries([]);
      setIsDirectory(true);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const tree = getTree();

    // For encrypted directories, we can't use isDirectory since it requires decryption
    // Instead, try to list and handle errors
    if (location.key) {
      // Encrypted - try to list directory with key
      tree.listDirectory(location).then(list => {
        if (!cancelled) {
          setEntries(sortEntries(list));
          setIsDirectory(true);
          setLoading(false);
        }
      }).catch(() => {
        // Could be a file or decryption failed
        if (!cancelled) {
          setEntries([]);
          setIsDirectory(false);
          setLoading(false);
        }
      });
    } else {
      // Public - first check if it's a directory
      tree.isDirectory(location).then(isDir => {
        if (cancelled) return;
        setIsDirectory(isDir);

        if (isDir) {
          // It's a directory - list entries
          return tree.listDirectory(location).then(list => {
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
    }

    return () => { cancelled = true; };
  }, [hashKey, encKey]); // Use string keys for stable comparison

  return { entries, loading, isDirectory };
}
