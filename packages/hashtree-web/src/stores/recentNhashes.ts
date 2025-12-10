/**
 * Store for tracking recently visited nhash permalinks
 * Persists to localStorage
 */
import { writable, get } from 'svelte/store';
import { routeStore } from './route';

const STORAGE_KEY = 'hashtree:recentNhashes';
const MAX_RECENT = 20;

export interface RecentNhash {
  nhash: string;
  hash: string;
  hasKey: boolean;
  visitedAt: number;
}

// Load from localStorage
function loadRecent(): RecentNhash[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // Ignore parse errors
  }
  return [];
}

// Save to localStorage
function saveRecent(recent: RecentNhash[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(recent));
  } catch {
    // Ignore storage errors
  }
}

// Create the store
export const recentNhashesStore = writable<RecentNhash[]>(loadRecent());

// Subscribe to route changes to track nhash visits
const HMR_KEY = '__recentNhashesInitialized';
const globalObj = typeof globalThis !== 'undefined' ? globalThis : window;

if (!(globalObj as Record<string, unknown>)[HMR_KEY]) {
  (globalObj as Record<string, unknown>)[HMR_KEY] = true;

  routeStore.subscribe((route) => {
    if (route.isPermalink && route.cid?.hash) {
      const hash = Array.from(route.cid.hash)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      // Build nhash from current URL
      const hashPath = window.location.hash.replace(/^#\/?/, '');
      const nhash = hashPath.split('/')[0];

      if (!nhash) return;

      const current = get(recentNhashesStore);

      // Remove existing entry with same hash
      const filtered = current.filter(r => r.hash !== hash);

      // Add new entry at the beginning
      const newEntry: RecentNhash = {
        nhash,
        hash,
        hasKey: !!route.cid.key,
        visitedAt: Math.floor(Date.now() / 1000),
      };

      const updated = [newEntry, ...filtered].slice(0, MAX_RECENT);
      recentNhashesStore.set(updated);
      saveRecent(updated);
    }
  });
}

/**
 * Remove a recent nhash entry
 */
export function removeRecentNhash(hash: string) {
  const current = get(recentNhashesStore);
  const updated = current.filter(r => r.hash !== hash);
  recentNhashesStore.set(updated);
  saveRecent(updated);
}

/**
 * Clear all recent nhashes
 */
export function clearRecentNhashes() {
  recentNhashesStore.set([]);
  saveRecent([]);
}
