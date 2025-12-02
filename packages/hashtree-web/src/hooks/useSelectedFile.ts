/**
 * Hook to derive selected file from URL path + entries
 * URL is the single source of truth for file selection
 */
import { useMemo } from 'react';
import { useRoute } from './useRoute';
import type { TreeEntry } from 'hashtree';

/**
 * Get selected file from entries based on URL path
 * @param entries - Directory entries to check against
 */
export function useSelectedFile(entries: TreeEntry[]) {
  const route = useRoute();

  return useMemo(() => {
    const urlPath = route.path;
    if (urlPath.length === 0) return null;

    // Check if last segment is a file in current entries
    const lastSegment = urlPath[urlPath.length - 1];
    const entry = entries.find(e => e.name === lastSegment && !e.isTree);

    return entry || null;
  }, [route.path, entries]);
}
