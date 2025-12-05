/**
 * Hook to derive current directory path from URL
 * If URL ends with a file (has extension), exclude it from path
 *
 * This hook does NOT depend on entries state - it uses URL heuristics only.
 * This ensures correct behavior on direct URL navigation before entries are loaded.
 */
import { useMemo } from 'react';
import { useRoute } from './useRoute';
import { looksLikeFile } from '../utils/route';

/**
 * Get current directory path from URL
 * Uses file extension heuristic - segments with extensions like .html, .js are files
 */
export function useCurrentPath(): string[] {
  const route = useRoute();

  return useMemo(() => {
    const urlPath = route.path;
    if (urlPath.length === 0) return [];

    const lastSegment = urlPath[urlPath.length - 1];

    if (looksLikeFile(lastSegment)) {
      return urlPath.slice(0, -1);
    }

    // No extension - assume it's a directory
    return urlPath;
  }, [route.path]);
}
