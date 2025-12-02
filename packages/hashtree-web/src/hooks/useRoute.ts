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

    // nhash route: /nhash1.../path... (path in URL segments, not encoded in nhash)
    if (parts[0] && isNHash(parts[0])) {
      try {
        const decoded = nhashDecode(parts[0]);
        return {
          npub: null,
          treeName: null,
          hash: decoded.hash,
          path: parts.slice(1), // Path comes from URL segments after nhash
          isPermalink: true,
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
          hash: null,
          path: decoded.path || [],
          isPermalink: false,
        };
      } catch {
        // Invalid npath, fall through
      }
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

      // Tree route: /npub/treeName/path...
      if (parts[1] && !['profile', 'follows', 'edit'].includes(parts[1])) {
        return {
          npub,
          treeName: parts[1],
          hash: null,
          path: parts.slice(2),
          isPermalink: false,
        };
      }

      // User view: /npub
      return { npub, treeName: null, hash: null, path: [], isPermalink: false };
    }

    // Home route
    return { npub: null, treeName: null, hash: null, path: [], isPermalink: false };
  }, [location.pathname]);
}
