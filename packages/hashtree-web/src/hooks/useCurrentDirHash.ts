/**
 * Hook to compute current directory CID from rootCid + URL path
 * For encrypted trees, resolves through the path collecting keys at each level
 */
import { useState, useEffect } from 'react';
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

  useEffect(() => {
    let cancelled = false;

    async function computeCid() {
      if (!rootCid) {
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
  }, [rootCid, currentPath]);

  return dirCid;
}
