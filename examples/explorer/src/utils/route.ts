/**
 * Route parsing utilities
 * Parses URL hash to extract route info without needing React Router context
 */

export interface RouteInfo {
  npub: string | null;
  treeName: string | null;
  hash: string | null;
  path: string[];
}

/**
 * Parse route info from window.location.hash
 * Handles:
 * - #/npub/treeName/path/to/file
 * - #/h/hash/path/to/file
 * - #/npub (user view)
 * - #/npub/profile
 */
export function parseRoute(): RouteInfo {
  // Get hash path, stripping query params
  const fullHash = window.location.hash.slice(2); // Remove #/
  const hashPath = fullHash.split('?')[0]; // Strip query params
  const parts = hashPath.split('/').filter(Boolean).map(decodeURIComponent);

  // Hash route: #/h/hash/path...
  if (parts[0] === 'h' && parts[1]) {
    return {
      npub: null,
      treeName: null,
      hash: parts[1],
      path: parts.slice(2),
    };
  }

  // Special routes (no tree context)
  if (['settings', 'wallet'].includes(parts[0])) {
    return { npub: null, treeName: null, hash: null, path: [] };
  }

  // User routes
  if (parts[0]?.startsWith('npub')) {
    const npub = parts[0];

    // Special user routes (profile, follows, edit)
    if (['profile', 'follows', 'edit'].includes(parts[1])) {
      return { npub, treeName: null, hash: null, path: [] };
    }

    // Tree route: #/npub/treeName/path...
    if (parts[1] && !['profile', 'follows', 'edit'].includes(parts[1])) {
      // Stream route is a special view, not a path within the tree
      const isStreamRoute = parts[2] === 'stream';
      return {
        npub,
        treeName: parts[1],
        hash: null,
        path: isStreamRoute ? [] : parts.slice(2),
      };
    }

    // User view: #/npub
    return { npub, treeName: null, hash: null, path: [] };
  }

  // Home route
  return { npub: null, treeName: null, hash: null, path: [] };
}

/**
 * Get current directory path from URL (excludes file if selected)
 * This needs access to entries to determine if last segment is a file
 */
export function getCurrentPathFromUrl(entries: { name: string; isTree: boolean }[]): string[] {
  const route = parseRoute();
  const urlPath = route.path;
  if (urlPath.length === 0) return [];

  // Check if last segment is a file in current entries
  const lastSegment = urlPath[urlPath.length - 1];
  const isFile = entries.some(e => e.name === lastSegment && !e.isTree);
  return isFile ? urlPath.slice(0, -1) : urlPath;
}
