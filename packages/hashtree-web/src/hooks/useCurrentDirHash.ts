/**
 * Hook to compute current directory CID from rootCid + URL path
 * For encrypted trees, resolves through the path collecting keys at each level
 */
import { useState, useEffect } from 'react';
import { toHex } from 'hashtree';
import { getTree } from '../store';
import { useCurrentPath } from './useCurrentPath';
import { useTreeRoot } from './useTreeRoot';
import type { CID, Hash } from 'hashtree';

export function useCurrentDirHash(): Hash | null {
  const cid = useCurrentDirCid();
  return cid?.hash ?? null;
}

export function useCurrentDirCid(): CID | null {
  const rootCid = useTreeRoot();
  const currentPath = useCurrentPath();
  const [dirCid, setDirCid] = useState<CID | null>(null);

  // Convert to stable string keys for comparison (Uint8Array reference changes on each render)
  const rootHash = rootCid?.hash ? toHex(rootCid.hash) : null;
  const rootKey = rootCid?.key ? toHex(rootCid.key) : null;
  const pathKey = currentPath.join('/');

  useEffect(() => {
    let cancelled = false;

    async function computeCid() {
      if (!rootCid || !rootHash) {
        setDirCid(null);
        return;
      }

      if (currentPath.length === 0) {
        setDirCid(rootCid);
        return;
      }

      const tree = getTree();

      // resolvePath now handles both encrypted and public trees via CID
      const result = await tree.resolvePath(rootCid, currentPath);
      if (!result) {
        if (!cancelled) setDirCid(null);
        return;
      }
      if (!cancelled) setDirCid(result.cid);
    }

    computeCid();
    return () => { cancelled = true; };
  }, [rootHash, rootKey, pathKey]); // Use string keys for stable comparison, rootCid/currentPath captured in closure

  return dirCid;
}
