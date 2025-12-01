/**
 * Hook to compute current directory hash from rootHash + URL path
 */
import { useState, useEffect } from 'react';
import { useAppStore, getTree } from '../store';
import { useCurrentPath } from './useCurrentPath';
import type { Hash } from 'hashtree';

export function useCurrentDirHash(): Hash | null {
  const rootHash = useAppStore(s => s.rootHash);
  const currentPath = useCurrentPath();
  const [dirHash, setDirHash] = useState<Hash | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function computeHash() {
      if (!rootHash) {
        setDirHash(null);
        return;
      }

      if (currentPath.length === 0) {
        setDirHash(rootHash);
        return;
      }

      const tree = getTree();
      let hash = rootHash;
      for (const part of currentPath) {
        const resolved = await tree.resolvePath(hash, part);
        if (!resolved) {
          if (!cancelled) setDirHash(null);
          return;
        }
        hash = resolved;
      }

      if (!cancelled) setDirHash(hash);
    }

    computeHash();
    return () => { cancelled = true; };
  }, [rootHash, currentPath]);

  return dirHash;
}
