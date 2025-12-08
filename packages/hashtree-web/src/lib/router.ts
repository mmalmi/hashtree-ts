/**
 * Simple hash router for Svelte 5
 */
import { writable, derived, get } from 'svelte/store';

// Current hash location
export const location = writable(window.location.hash.slice(1) || '/');

// Listen to hash changes
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    location.set(window.location.hash.slice(1) || '/');
  });
}

// Navigate to a new hash route
export function push(path: string) {
  window.location.hash = path;
}

export function replace(path: string) {
  window.location.replace('#' + path);
}

// Parse route parameters
export interface RouteParams {
  [key: string]: string;
}

export interface RouteMatch {
  matched: boolean;
  params: RouteParams;
}

// Match a path against a pattern (e.g., '/user/:npub' matches '/user/npub123')
export function matchRoute(pattern: string, path: string): RouteMatch {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = path.split('/').filter(Boolean);

  // Handle query string
  const queryIndex = pathParts[pathParts.length - 1]?.indexOf('?');
  if (queryIndex !== -1 && pathParts.length > 0) {
    pathParts[pathParts.length - 1] = pathParts[pathParts.length - 1].substring(0, queryIndex);
  }

  if (patternParts.length !== pathParts.length) {
    // Check for wildcard pattern ending with *
    if (patternParts[patternParts.length - 1] === '*') {
      // Wildcard matches anything remaining
      if (pathParts.length >= patternParts.length - 1) {
        const params: RouteParams = {};
        for (let i = 0; i < patternParts.length - 1; i++) {
          if (patternParts[i].startsWith(':')) {
            params[patternParts[i].slice(1)] = decodeURIComponent(pathParts[i]);
          } else if (patternParts[i] !== pathParts[i]) {
            return { matched: false, params: {} };
          }
        }
        // Capture the rest as 'wild' param
        params['wild'] = pathParts.slice(patternParts.length - 1).join('/');
        return { matched: true, params };
      }
    }
    return { matched: false, params: {} };
  }

  const params: RouteParams = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i] === '*') {
      // Wildcard captures remaining path
      params['wild'] = pathParts.slice(i).join('/');
      return { matched: true, params };
    } else if (patternParts[i].startsWith(':')) {
      params[patternParts[i].slice(1)] = decodeURIComponent(pathParts[i]);
    } else if (patternParts[i] !== pathParts[i]) {
      return { matched: false, params: {} };
    }
  }

  return { matched: true, params };
}

// Get current query params
export function getQueryParams(): URLSearchParams {
  const hash = window.location.hash.slice(1);
  const queryIndex = hash.indexOf('?');
  if (queryIndex === -1) return new URLSearchParams();
  return new URLSearchParams(hash.slice(queryIndex + 1));
}
