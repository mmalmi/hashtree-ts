/**
 * Route store for Svelte
 * Provides route information from current URL
 */
import { writable, derived, get } from 'svelte/store';
import { isNHash, isNPath, nhashDecode, npathDecode } from 'hashtree';
import { nip19 } from 'nostr-tools';
import type { RouteInfo } from '../utils/route';

// Store for the current hash
export const currentHash = writable<string>(window.location.hash);

// Initialize hash listener
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    currentHash.set(window.location.hash);
  });
}

/**
 * Parse route info from hash
 */
export function parseRouteFromHash(hash: string): RouteInfo {
  // Remove #/ prefix
  const hashPath = hash.replace(/^#\/?/, '');

  // Parse query params
  let path = hashPath;
  let linkKey: string | null = null;
  let isStreaming = false;

  const qIdx = hashPath.indexOf('?');
  if (qIdx !== -1) {
    path = hashPath.slice(0, qIdx);
    const params = new URLSearchParams(hashPath.slice(qIdx + 1));
    linkKey = params.get('k');
    isStreaming = params.get('stream') === '1';
  }

  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);

  // nhash route: /nhash1.../path...
  if (parts[0] && isNHash(parts[0])) {
    try {
      const decoded = nhashDecode(parts[0]);
      return {
        npub: null,
        treeName: null,
        cid: { hash: decoded.hash, key: decoded.decryptKey },
        path: parts.slice(1),
        isPermalink: true,
        linkKey,
        isStreaming,
      };
    } catch {
      // Invalid nhash, fall through
    }
  }

  // npath route: /npath1...
  if (parts[0] && isNPath(parts[0])) {
    try {
      const decoded = npathDecode(parts[0]);
      const npub = nip19.npubEncode(decoded.pubkey);
      return {
        npub,
        treeName: decoded.treeName,
        cid: null,
        path: decoded.path || [],
        isPermalink: false,
        linkKey,
        isStreaming,
      };
    } catch {
      // Invalid npath, fall through
    }
  }

  // Special routes (no tree context)
  if (['settings', 'wallet', 'users'].includes(parts[0])) {
    return { npub: null, treeName: null, cid: null, path: [], isPermalink: false, linkKey: null, isStreaming: false };
  }

  // User routes
  if (parts[0]?.startsWith('npub')) {
    const npub = parts[0];

    // Special user routes (profile, follows, edit)
    if (['profile', 'follows', 'edit'].includes(parts[1])) {
      return { npub, treeName: null, cid: null, path: [], isPermalink: false, linkKey: null, isStreaming: false };
    }

    // Tree route: /npub/treeName/path...
    if (parts[1] && !['profile', 'follows', 'edit'].includes(parts[1])) {
      return {
        npub,
        treeName: parts[1],
        cid: null,
        path: parts.slice(2),
        isPermalink: false,
        linkKey,
        isStreaming,
      };
    }

    // User view: /npub
    return { npub, treeName: null, cid: null, path: [], isPermalink: false, linkKey: null, isStreaming: false };
  }

  // Home route
  return { npub: null, treeName: null, cid: null, path: [], isPermalink: false, linkKey: null, isStreaming: false };
}

/**
 * Derived store for route info
 */
export const routeStore = derived(currentHash, ($hash) => parseRouteFromHash($hash));

/**
 * Get current route synchronously
 */
export function getRouteSync(): RouteInfo {
  return parseRouteFromHash(get(currentHash));
}

/**
 * Derived store for just the current path
 */
export const currentPathStore = derived(routeStore, ($route) => $route.path);
