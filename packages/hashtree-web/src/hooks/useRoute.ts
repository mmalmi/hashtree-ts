import { useMemo, useSyncExternalStore } from 'react';
import { useLocation } from 'react-router-dom';
import { isNHash, isNPath, nhashDecode, npathDecode } from 'hashtree';
import { nip19 } from 'nostr-tools';
import type { RouteInfo } from '../utils/route';

// Subscribe to hash changes for proper reactivity
function subscribeToHash(callback: () => void) {
  window.addEventListener('hashchange', callback);
  return () => window.removeEventListener('hashchange', callback);
}

function getHash() {
  return window.location.hash;
}

/**
 * React hook to get route info from current URL
 * Re-renders when location changes
 */
export function useRoute(): RouteInfo {
  const location = useLocation();
  // Subscribe to raw hash changes to catch ?k= param changes
  const hash = useSyncExternalStore(subscribeToHash, getHash, getHash);

  return useMemo(() => {
    const hashPath = location.pathname;
    const parts = hashPath.split('/').filter(Boolean).map(decodeURIComponent);

    // Parse query params (for unlisted trees and streaming mode)
    // With HashRouter, params are in the hash: /#/path?k=xxx&stream=1
    // React Router's location.search may or may not contain this depending on router version
    // So we always parse from the raw hash to be safe
    let linkKey: string | null = null;
    let isStreaming = false;

    // First try location.search (works in some React Router setups)
    if (location.search) {
      const params = new URLSearchParams(location.search);
      linkKey = params.get('k');
      isStreaming = params.get('stream') === '1';
    }

    // Always check raw hash as primary source for HashRouter
    const qIdx = hash.indexOf('?');
    if (qIdx !== -1) {
      const hashSearch = hash.slice(qIdx + 1);
      const params = new URLSearchParams(hashSearch);
      if (!linkKey) linkKey = params.get('k');
      if (!isStreaming) isStreaming = params.get('stream') === '1';
    }

    console.log('[useRoute] linkKey:', linkKey, 'isStreaming:', isStreaming, 'hash:', hash);
    // nhash route: /nhash1.../path... (path in URL segments, not encoded in nhash)
    if (parts[0] && isNHash(parts[0])) {
      try {
        const decoded = nhashDecode(parts[0]);
        return {
          npub: null,
          treeName: null,
          cid: { hash: decoded.hash, key: decoded.decryptKey },
          path: parts.slice(1), // Path comes from URL segments after nhash
          isPermalink: true,
          linkKey,
          isStreaming,
        };
      } catch {
        // Invalid nhash, fall through
      }
    }

    // npath route: /npath1... (live reference, path encoded inside)
    if (parts[0] && isNPath(parts[0])) {
      try {
        const decoded = npathDecode(parts[0]);
        // Convert hex pubkey to npub for consistency with rest of app
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
    if (['settings', 'wallet'].includes(parts[0])) {
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
  }, [location.pathname, location.search, hash]);
}
