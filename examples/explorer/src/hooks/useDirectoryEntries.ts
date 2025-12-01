/**
 * Hook to fetch directory entries using TreeReader directly
 * Replaces global entries state with local component state
 */
import { useState, useEffect } from 'react';
import { type Hash, type TreeEntry } from 'hashtree';
import { getTree } from '../store';

/**
 * Fetch directory entries for a given hash
 * Returns entries and loading state
 */
export function useDirectoryEntries(dirHash: Hash | null) {
  const [entries, setEntries] = useState<TreeEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!dirHash) {
      setEntries([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    getTree().listDirectory(dirHash).then(list => {
      if (!cancelled) {
        setEntries(list);
        setLoading(false);
      }
    }).catch(err => {
      if (!cancelled) {
        setError(err);
        setLoading(false);
      }
    });

    return () => { cancelled = true; };
  }, [dirHash]);

  return { entries, loading, error, setEntries };
}
