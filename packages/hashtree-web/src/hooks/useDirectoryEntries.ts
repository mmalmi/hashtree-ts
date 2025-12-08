/**
 * Hook to fetch directory entries from tree
 * Simple - just reads from tree, no caching or global state
 * Supports both encrypted and public directories via CID
 * Svelte version using stores
 */
import { writable, derived, get, type Readable } from 'svelte/store';
import { type CID, type TreeEntry, toHex } from 'hashtree';
import { getTree } from '../store';

// Sort entries: directories first, then alphabetically
function sortEntries(entries: TreeEntry[]): TreeEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isTree !== b.isTree) return a.isTree ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export interface DirectoryEntriesState {
  entries: TreeEntry[];
  loading: boolean;
  isDirectory: boolean;
}

/**
 * Create a store for directory entries for a given CID
 */
export function createDirectoryEntriesStore(locationStore: Readable<CID | null>): Readable<DirectoryEntriesState> {
  const state = writable<DirectoryEntriesState>({
    entries: [],
    loading: false,
    isDirectory: true,
  });

  let prevHashKey: string | null = null;
  let prevEncKey: string | null = null;

  // Subscribe to location changes
  locationStore.subscribe(async (location) => {
    const hashKey = location?.hash ? toHex(location.hash) : null;
    const encKey = location?.key ? toHex(location.key) : null;

    // Skip if no change
    if (hashKey === prevHashKey && encKey === prevEncKey) return;
    prevHashKey = hashKey;
    prevEncKey = encKey;

    if (!location || !hashKey) {
      state.set({ entries: [], loading: false, isDirectory: true });
      return;
    }

    state.update(s => ({ ...s, loading: true }));
    const tree = getTree();

    try {
      if (location.key) {
        // Encrypted - try to list directory with key
        const list = await tree.listDirectory(location);
        state.set({ entries: sortEntries(list), loading: false, isDirectory: true });
      } else {
        // Public - first check if it's a directory
        const isDir = await tree.isDirectory(location);

        if (isDir) {
          const list = await tree.listDirectory(location);
          state.set({ entries: sortEntries(list), loading: false, isDirectory: true });
        } else {
          state.set({ entries: [], loading: false, isDirectory: false });
        }
      }
    } catch {
      state.set({ entries: [], loading: false, isDirectory: false });
    }
  });

  return { subscribe: state.subscribe };
}

/**
 * Synchronous function to use directory entries (React-style hook compatibility)
 * For components that need to use the entries synchronously
 */
export function useDirectoryEntries(location: CID | null): DirectoryEntriesState {
  const locationStore = writable(location);
  const store = createDirectoryEntriesStore(locationStore);
  return get(store);
}

// Import currentDirCidStore for global entries store
import { currentDirCidStore } from './useCurrentDirHash';

/**
 * Global directory entries store based on current directory CID
 */
export const directoryEntriesStore = createDirectoryEntriesStore(currentDirCidStore);
