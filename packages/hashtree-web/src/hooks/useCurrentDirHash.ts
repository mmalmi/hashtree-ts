/**
 * Hook to compute current directory hash and key from rootHash + URL path
 * For encrypted trees, resolves through the path collecting keys at each level
 */
import { useState, useEffect } from 'react';
import { useAppStore, getTree } from '../store';
import { useCurrentPath } from './useCurrentPath';
import type { Hash, EncryptionKey } from 'hashtree';

export interface DirLocation {
  hash: Hash;
  key: EncryptionKey | null;
}

export function useCurrentDirHash(): Hash | null {
  const location = useCurrentDirLocation();
  return location?.hash ?? null;
}

export function useCurrentDirLocation(): DirLocation | null {
  const rootHash = useAppStore(s => s.rootHash);
  const rootKey = useAppStore(s => s.rootKey);
  const currentPath = useCurrentPath();
  const [location, setLocation] = useState<DirLocation | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function computeLocation() {
      if (!rootHash) {
        setLocation(null);
        return;
      }

      if (currentPath.length === 0) {
        setLocation({ hash: rootHash, key: rootKey });
        return;
      }

      const tree = getTree();

      if (rootKey) {
        // Encrypted tree - resolve through path collecting keys
        let hash = rootHash;
        let key: EncryptionKey | null = rootKey;

        for (const part of currentPath) {
          // List the directory to find the entry with its key
          const entries = await tree.listDirectory(hash, key!);
          const entry = entries.find(e => e.name === part);
          if (!entry) {
            if (!cancelled) setLocation(null);
            return;
          }
          hash = entry.hash;
          key = entry.key ?? null;
        }

        if (!cancelled) setLocation({ hash, key });
      } else {
        // Public tree - use simple path resolution
        let hash = rootHash;
        for (const part of currentPath) {
          const resolved = await tree.resolvePath(hash, part);
          if (!resolved) {
            if (!cancelled) setLocation(null);
            return;
          }
          hash = resolved;
        }

        if (!cancelled) setLocation({ hash, key: null });
      }
    }

    computeLocation();
    return () => { cancelled = true; };
  }, [rootHash, rootKey, currentPath]);

  return location;
}
