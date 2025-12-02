/**
 * Route parsing utilities
 * Parses URL hash to extract route info without needing React Router context
 */

export interface RouteInfo {
  npub: string | null;
  treeName: string | null;
  hash: string | null;
  path: string[];
  /** True when viewing a permalink (nhash route) */
  isPermalink: boolean;
}

/**
 * Parse route info from window.location.hash
 * Handles:
 * - #/npub/treeName/path/to/file
 * - #/nhash1.../path/to/file
 * - #/npub (user view)
 * - #/npub/profile
 */
export function parseRoute(): RouteInfo {
  // Get hash path, stripping query params
  const fullHash = window.location.hash.slice(2); // Remove #/
  const hashPath = fullHash.split('?')[0]; // Strip query params
  const parts = hashPath.split('/').filter(Boolean).map(decodeURIComponent);

  // nhash route: #/nhash1.../path...
  if (parts[0]?.startsWith('nhash1')) {
    return {
      npub: null,
      treeName: null,
      hash: parts[0], // Keep the nhash string, caller can decode
      path: parts.slice(1),
      isPermalink: true,
    };
  }

  // Special routes (no tree context)
  if (['settings', 'wallet'].includes(parts[0])) {
    return { npub: null, treeName: null, hash: null, path: [], isPermalink: false };
  }

  // User routes
  if (parts[0]?.startsWith('npub')) {
    const npub = parts[0];

    // Special user routes (profile, follows, edit)
    if (['profile', 'follows', 'edit'].includes(parts[1])) {
      return { npub, treeName: null, hash: null, path: [], isPermalink: false };
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
        isPermalink: false,
      };
    }

    // User view: #/npub
    return { npub, treeName: null, hash: null, path: [], isPermalink: false };
  }

  // Home route
  return { npub: null, treeName: null, hash: null, path: [], isPermalink: false };
}

/**
 * Get current directory path from URL (excludes file if selected)
 * Uses file extension heuristic - no entries needed
 */
export function getCurrentPathFromUrl(): string[] {
  const route = parseRoute();
  const urlPath = route.path;
  if (urlPath.length === 0) return [];

  // Check if last segment looks like a file (has extension)
  const lastSegment = urlPath[urlPath.length - 1];
  const looksLikeFile = /\.[a-zA-Z0-9]+$/.test(lastSegment);
  return looksLikeFile ? urlPath.slice(0, -1) : urlPath;
}
