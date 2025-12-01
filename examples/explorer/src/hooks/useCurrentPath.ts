/**
 * Hook to derive current directory path from URL
 * If URL ends with a file (found in entries), exclude it from path
 */
import { useMemo } from 'react';
import { useAppStore } from '../store';
import { useRoute } from './useRoute';
import type { TreeEntry } from 'hashtree';

/**
 * Get current directory path from URL
 * @param entries - Pass entries to avoid stale global state issues
 */
export function useCurrentPath(entries?: TreeEntry[]): string[] {
  const route = useRoute();
  const globalEntries = useAppStore(s => s.entries);

  // Use provided entries or fall back to global store
  const effectiveEntries = entries ?? globalEntries;

  return useMemo(() => {
    const urlPath = route.path;
    if (urlPath.length === 0) return [];

    // Check if last segment is a file in current entries
    const lastSegment = urlPath[urlPath.length - 1];
    const isFile = effectiveEntries.some(e => e.name === lastSegment && !e.isTree);

    // If last segment is a file, directory path excludes it
    return isFile ? urlPath.slice(0, -1) : urlPath;
  }, [route.path, effectiveEntries]);
}
