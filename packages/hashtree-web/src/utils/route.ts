/**
 * Route parsing utilities
 * Parses URL hash to extract route info without needing React Router context
 */

/** CID in hex format for routing (hash + optional key) */
export interface RouteCid {
  hash: string;
  key?: string;
}

export interface RouteInfo {
  npub: string | null;
  treeName: string | null;
  /** CID for permalink routes (hash + optional decrypt key) */
  cid: RouteCid | null;
  path: string[];
  /** True when viewing a permalink (nhash route) */
  isPermalink: boolean;
  /** Link key for unlisted trees (from ?k= param) */
  linkKey: string | null;
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
  // Get hash path and query params
  const fullHash = window.location.hash.slice(2); // Remove #/
  const [hashPath, queryString] = fullHash.split('?');
  const parts = hashPath.split('/').filter(Boolean).map(decodeURIComponent);

  // Parse link key from query params (for unlisted trees)
  let linkKey: string | null = null;
  if (queryString) {
    const params = new URLSearchParams(queryString);
    linkKey = params.get('k');
  }

  // nhash route: #/nhash1.../path...
  if (parts[0]?.startsWith('nhash1')) {
    // Decode nhash to extract hash and optional decrypt key
    try {
      const { nhashDecode } = require('hashtree');
      const decoded = nhashDecode(parts[0]);
      return {
        npub: null,
        treeName: null,
        cid: { hash: decoded.hash, key: decoded.decryptKey },
        path: parts.slice(1),
        isPermalink: true,
        linkKey,
      };
    } catch {
      // Fall through if decode fails
    }
  }

  // Special routes (no tree context)
  if (['settings', 'wallet'].includes(parts[0])) {
    return { npub: null, treeName: null, cid: null, path: [], isPermalink: false, linkKey: null };
  }

  // User routes
  if (parts[0]?.startsWith('npub')) {
    const npub = parts[0];

    // Special user routes (profile, follows, edit)
    if (['profile', 'follows', 'edit'].includes(parts[1])) {
      return { npub, treeName: null, cid: null, path: [], isPermalink: false, linkKey: null };
    }

    // Tree route: #/npub/treeName/path...
    if (parts[1] && !['profile', 'follows', 'edit'].includes(parts[1])) {
      // Stream route is a special view, not a path within the tree
      const isStreamRoute = parts[2] === 'stream';
      return {
        npub,
        treeName: parts[1],
        cid: null,
        path: isStreamRoute ? [] : parts.slice(2),
        isPermalink: false,
        linkKey,
      };
    }

    // User view: #/npub
    return { npub, treeName: null, cid: null, path: [], isPermalink: false, linkKey: null };
  }

  // Home route
  return { npub: null, treeName: null, cid: null, path: [], isPermalink: false, linkKey: null };
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
