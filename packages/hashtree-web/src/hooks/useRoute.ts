import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { isNHash, isNPath, nhashDecode, npathDecode } from 'hashtree';
import { nip19 } from 'nostr-tools';
import type { RouteInfo } from '../utils/route';

/**
 * React hook to get route info from current URL
 * Re-renders when location changes
 */
export function useRoute(): RouteInfo {
  const location = useLocation();

  return useMemo(() => {
    const hashPath = location.pathname;
    const parts = hashPath.split('/').filter(Boolean).map(decodeURIComponent);

    // Parse link key from query params (for unlisted trees)
    // With HashRouter, params are part of the hash: /#/path?k=xxx
    // React Router's location.search should contain this, but as a fallback
    // we also parse from the raw hash
    let linkKey = new URLSearchParams(location.search).get('k');
    if (!linkKey) {
      const hashPart = window.location.hash;
      const qIdx = hashPart.indexOf('?');
      if (qIdx !== -1) {
        const hashSearch = hashPart.slice(qIdx + 1);
        linkKey = new URLSearchParams(hashSearch).get('k');
      }
    }
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
        };
      } catch {
        // Invalid npath, fall through
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

      // Tree route: /npub/treeName/path...
      if (parts[1] && !['profile', 'follows', 'edit'].includes(parts[1])) {
        return {
          npub,
          treeName: parts[1],
          cid: null,
          path: parts.slice(2),
          isPermalink: false,
          linkKey,
        };
      }

      // User view: /npub
      return { npub, treeName: null, cid: null, path: [], isPermalink: false, linkKey: null };
    }

    // Home route
    return { npub: null, treeName: null, cid: null, path: [], isPermalink: false, linkKey: null };
  }, [location.pathname, location.search]);
}
