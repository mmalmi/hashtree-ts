/**
 * Hook to derive current directory path from URL
 * If URL ends with a file (has extension), exclude it from path
 *
 * This hook does NOT depend on entries state - it uses URL heuristics only.
 * This ensures correct behavior on direct URL navigation before entries are loaded.
 */
import { useMemo } from 'react';
import { useRoute } from './useRoute';

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

    // Check if last segment looks like a file (has extension)
    // Common file extensions - if it has a dot followed by alphanumeric chars, it's a file
    const looksLikeFile = /\.[a-zA-Z0-9]+$/.test(lastSegment);

    if (looksLikeFile) {
      return urlPath.slice(0, -1);
    }

    // No extension - assume it's a directory
    return urlPath;
  }, [route.path]);
}
