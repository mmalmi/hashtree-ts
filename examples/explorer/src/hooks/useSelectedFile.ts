/**
 * Hook to derive selected file from URL path + entries
 * URL is the single source of truth for file selection
 */
import { useMemo } from 'react';
import { useAppStore } from '../store';
import { useRoute } from './useRoute';
import type { TreeEntry } from 'hashtree';

/**
 * Get selected file from entries based on URL path
 * @param entries - Pass entries to avoid stale global state issues
 */
export function useSelectedFile(entries?: TreeEntry[]) {
  const route = useRoute();
  const globalEntries = useAppStore(s => s.entries);

  // Use provided entries or fall back to global store
  const effectiveEntries = entries ?? globalEntries;

  return useMemo(() => {
    const urlPath = route.path;
    if (urlPath.length === 0) return null;

    // Check if last segment is a file in current entries
    const lastSegment = urlPath[urlPath.length - 1];
    const entry = effectiveEntries.find(e => e.name === lastSegment && !e.isTree);

    return entry || null;
  }, [route.path, effectiveEntries]);
}
