/**
 * Hook for managing recently visited locations
 * Persists to localStorage
 */
import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'hashtree:recents';
const MAX_RECENTS = 20;

export interface RecentItem {
  type: 'tree' | 'file' | 'hash';
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
    return stored ? JSON.parse(stored) : [];
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
