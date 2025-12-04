/**
 * Hook for managing recently visited locations
 * Persists to localStorage
 */
import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'hashtree:recents';
const MAX_RECENTS = 20;

export interface RecentItem {
  type: 'tree' | 'file' | 'dir' | 'hash';
  /** Display label */
  label: string;
  /** URL path to navigate to */
  path: string;
  /** Timestamp of last visit */
  timestamp: number;
  /** Optional npub for tree/file types */
  npub?: string;
  /** Optional tree name */
  treeName?: string;
}

// Module-level state
let recents: RecentItem[] = loadRecents();
const listeners = new Set<() => void>();

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

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return recents;
}

function setRecents(items: RecentItem[]) {
  recents = items;
  saveRecents(items);
  listeners.forEach(l => l());
}

/**
 * Add or update a recent item
 * Moves existing items to top, deduplicates by path
 */
export function addRecent(item: Omit<RecentItem, 'timestamp'>) {
  const newItem: RecentItem = { ...item, timestamp: Date.now() };

  // Remove existing item with same path
  const filtered = recents.filter(r => r.path !== item.path);

  // Add to front, trim to max
  const updated = [newItem, ...filtered].slice(0, MAX_RECENTS);
  setRecents(updated);
}

/**
 * Clear all recents
 */
export function clearRecents() {
  setRecents([]);
}

/**
 * Hook to read recents
 */
export function useRecents(): RecentItem[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
