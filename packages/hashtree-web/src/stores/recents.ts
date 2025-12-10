/**
 * Store for managing recently visited locations
 * Persists to localStorage, uses Svelte stores
 */
import { writable, get } from 'svelte/store';
import type { TreeVisibility } from 'hashtree';

const STORAGE_KEY = 'hashtree:recents';
const MAX_RECENTS = 20;

export interface RecentItem {
  type: 'tree' | 'file' | 'dir' | 'hash';
  /** Display label */
  label: string;
  /** URL path to navigate to (without query params) */
  path: string;
  /** Timestamp of last visit */
  timestamp: number;
  /** Optional npub for tree/file types */
  npub?: string;
  /** Optional tree name */
  treeName?: string;
  /** Optional visibility for tree/file types */
  visibility?: TreeVisibility;
  /** Optional link key for unlisted trees */
  linkKey?: string;
}

function loadRecents(): RecentItem[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    const items: RecentItem[] = JSON.parse(stored);
    // Clean up: hash type items shouldn't have npub
    let cleaned = false;
    const cleanedItems = items.map(item => {
      if (item.type === 'hash' && item.npub) {
        cleaned = true;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { npub, ...rest } = item;
        return rest;
      }
      return item;
    });
    // Persist cleaned data
    if (cleaned) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cleanedItems));
    }
    return cleanedItems;
  } catch {
    return [];
  }
}

function saveRecents(items: RecentItem[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Ignore storage errors
  }
}

// Svelte store for recents
export const recentsStore = writable<RecentItem[]>(loadRecents());

/**
 * Add or update a recent item
 * Moves existing items to top, deduplicates by path
 */
export function addRecent(item: Omit<RecentItem, 'timestamp'>) {
  const newItem: RecentItem = { ...item, timestamp: Date.now() };

  recentsStore.update(current => {
    // Remove existing item with same path
    const filtered = current.filter(r => r.path !== item.path);

    // Add to front, trim to max
    const updated = [newItem, ...filtered].slice(0, MAX_RECENTS);
    saveRecents(updated);
    return updated;
  });
}

/**
 * Update a recent item's visibility by path
 */
export function updateRecentVisibility(path: string, visibility: TreeVisibility) {
  recentsStore.update(current => {
    const updated = current.map(item =>
      item.path === path ? { ...item, visibility } : item
    );
    saveRecents(updated);
    return updated;
  });
}

/**
 * Clear all recents
 */
export function clearRecents() {
  recentsStore.set([]);
  saveRecents([]);
}

/**
 * Get current recents synchronously
 */
export function getRecentsSync(): RecentItem[] {
  return get(recentsStore);
}
