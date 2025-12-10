/**
 * Hook to fetch directory entries from tree
 * Simple - just reads from tree, no caching or global state
 * Supports both encrypted and public directories via CID
 * Svelte version using stores
 */
import { writable, get, type Readable } from 'svelte/store';
import { type CID, type TreeEntry, toHex } from 'hashtree';
import { getTree } from '../store';
import { markFilesChanged } from './recentlyChanged';

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
export function createDirectoryEntriesStore(locationStore: Readable<CID | null>, trackChanges = false): Readable<DirectoryEntriesState> {
  const state = writable<DirectoryEntriesState>({
    entries: [],
    loading: false,
    isDirectory: true,
  });

  let prevHashKey: string | null = null;
  let prevEncKey: string | null = null;
  // Track previous entries by name -> CID hash to detect changes
  let prevEntryCids: Map<string, string> = new Map();

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
      prevEntryCids.clear();
      return;
    }

    state.update(s => ({ ...s, loading: true }));
    const tree = getTree();

    try {
      let newEntries: TreeEntry[] = [];

      if (location.key) {
        // Encrypted - try to list directory with key
        newEntries = await tree.listDirectory(location);
      } else {
        // Public - first check if it's a directory
        const isDir = await tree.isDirectory(location);

        if (isDir) {
          newEntries = await tree.listDirectory(location);
        } else {
          state.set({ entries: [], loading: false, isDirectory: false });
          prevEntryCids.clear();
          return;
        }
      }

      // Detect changed files (CID changed for same filename)
      if (trackChanges && prevEntryCids.size > 0) {
        const changedFiles = new Set<string>();
        for (const entry of newEntries) {
          const prevCid = prevEntryCids.get(entry.name);
          const newCid = entry.cid?.hash ? toHex(entry.cid.hash) : null;
          if (prevCid && newCid && prevCid !== newCid) {
            changedFiles.add(entry.name);
          }
        }
        if (changedFiles.size > 0) {
          markFilesChanged(changedFiles);
        }
      }

      // Update prev entry CIDs for next comparison
      prevEntryCids = new Map();
      for (const entry of newEntries) {
        if (entry.cid?.hash) {
          prevEntryCids.set(entry.name, toHex(entry.cid.hash));
        }
      }

      state.set({ entries: sortEntries(newEntries), loading: false, isDirectory: true });
    } catch {
      state.set({ entries: [], loading: false, isDirectory: false });
      prevEntryCids.clear();
    }
  });

  return { subscribe: state.subscribe };
}

/**
 * Synchronous function to use directory entries (React-style hook compatibility)
 * For components that need to use the entries synchronously
 */
export function directoryEntries(location: CID | null): DirectoryEntriesState {
  const locationStore = writable(location);
  const store = createDirectoryEntriesStore(locationStore);
  return get(store);
}

// Import currentDirCidStore for global entries store
import { currentDirCidStore } from './currentDirHash';

/**
 * Global directory entries store based on current directory CID
 * trackChanges=true to detect when files change (for LIVE indicator)
 */
export const directoryEntriesStore = createDirectoryEntriesStore(currentDirCidStore, true);
