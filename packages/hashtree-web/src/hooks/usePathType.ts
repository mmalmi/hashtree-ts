/**
 * Hook to determine if the last URL path segment is a file or directory
 * Uses actual hashtree data instead of filename heuristics
 */
import { useState, useEffect, useMemo } from 'react';
import { toHex } from 'hashtree';
import { getTree } from '../store';
import { useRoute } from './useRoute';
import { useTreeRoot } from './useTreeRoot';
import { looksLikeFile } from '../utils/route';

export interface PathTypeInfo {
  /** Whether the last segment is confirmed to be a file */
  isFile: boolean;
  /** Whether we're still resolving the path type */
  loading: boolean;
  /** The directory path (excludes file if last segment is a file) */
  dirPath: string[];
  /** The filename if last segment is a file, null otherwise */
  fileName: string | null;
}

/**
 * Resolve whether the last URL path segment is a file or directory
 * Falls back to looksLikeFile heuristic while loading, but uses
 * actual hashtree isTree data once resolved
 */
export function usePathType(): PathTypeInfo {
  const route = useRoute();
  const rootCid = useTreeRoot();
  const urlPath = route.path;

  // Initial guess using heuristic (for immediate render before async resolves)
  const heuristicGuess = useMemo(() => {
    if (urlPath.length === 0) {
      return { isFile: false, dirPath: [], fileName: null };
    }
    const lastSegment = urlPath[urlPath.length - 1];
    const guessIsFile = looksLikeFile(lastSegment);
    return {
      isFile: guessIsFile,
      dirPath: guessIsFile ? urlPath.slice(0, -1) : urlPath,
      fileName: guessIsFile ? lastSegment : null,
    };
  }, [urlPath]);

  const [resolved, setResolved] = useState<{
    isFile: boolean;
    dirPath: string[];
    fileName: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  const rootHash = rootCid?.hash ? toHex(rootCid.hash) : null;
  const pathKey = urlPath.join('/');

  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      // No path - it's the root directory
      if (urlPath.length === 0) {
        if (!cancelled) {
          setResolved({ isFile: false, dirPath: [], fileName: null });
          setLoading(false);
        }
        return;
      }

      // No root CID yet - wait for it
      if (!rootCid) {
        if (!cancelled) {
          setResolved(null);
          setLoading(true);
        }
        return;
      }

      setLoading(true);
      const tree = getTree();
      const lastSegment = urlPath[urlPath.length - 1];

      try {
        // Resolve the full path including last segment
        // resolvePath accepts string or array and returns { cid, isTree }
        const result = await tree.resolvePath(rootCid, urlPath);

        if (!result) {
          // Path doesn't exist - fall back to heuristic
          if (!cancelled) {
            setResolved(heuristicGuess);
            setLoading(false);
          }
          return;
        }

        // Use isTree from resolvePath result (no need for separate isDirectory call)
        if (!cancelled) {
          if (result.isTree) {
            // It's a directory
            setResolved({
              isFile: false,
              dirPath: urlPath,
              fileName: null,
            });
          } else {
            // It's a file
            setResolved({
              isFile: true,
              dirPath: urlPath.slice(0, -1),
              fileName: lastSegment,
            });
          }
          setLoading(false);
        }
      } catch {
        // Resolution failed - fall back to heuristic
        if (!cancelled) {
          setResolved(heuristicGuess);
          setLoading(false);
        }
      }
    }

    resolve();
    return () => { cancelled = true; };
  }, [rootHash, pathKey, heuristicGuess]);

  // Use resolved value if available, otherwise use heuristic guess
  const result = resolved ?? heuristicGuess;

  return {
    ...result,
    loading,
  };
}
