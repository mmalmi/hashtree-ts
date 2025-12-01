import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
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

    // Hash route: /h/hash/path...
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

      // Tree route: /npub/treeName/path...
      if (parts[1] && !['profile', 'follows', 'edit'].includes(parts[1])) {
        return {
          npub,
          treeName: parts[1],
          hash: null,
          path: parts.slice(2),
        };
      }

      // User view: /npub
      return { npub, treeName: null, hash: null, path: [] };
    }

    // Home route
    return { npub: null, treeName: null, hash: null, path: [] };
  }, [location.pathname]);
}
