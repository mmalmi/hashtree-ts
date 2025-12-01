/**
 * Shared state and store instances using zustand
 */
import { create } from 'zustand';
import {
  IndexedDBStore,
  HashTree,
  WebRTCStore,
} from 'hashtree';
import type { Hash, TreeEntry, PeerStatus, EventSigner, EventEncrypter, EventDecrypter } from 'hashtree';

// Helper to compare hash arrays
function hashesEqual(a: Hash, b: Hash): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// Store instances - using IndexedDB for persistence
export const idbStore = new IndexedDBStore('hashtree-explorer');

// HashTree instance - single class for all tree operations
let _tree = new HashTree({ store: idbStore, chunkSize: 1024 });

// Getter for tree - always returns current instance
export function getTree(): HashTree {
  return _tree;
}


// WebRTC store - initialized when user logs in with a key
export let webrtcStore: WebRTCStore | null = null;

// Storage stats
export interface StorageStats {
  items: number;
  bytes: number;
}

// App state store
interface AppState {
  rootHash: Hash | null;
  entries: TreeEntry[];

  // WebRTC state
  peerCount: number;
  peers: PeerStatus[];
  myPeerId: string | null;

  // Storage stats
  stats: StorageStats;

  // Actions
  setRootHash: (hash: Hash | null) => void;
  setEntries: (entries: TreeEntry[]) => void;
  setPeerCount: (count: number) => void;
  setPeers: (peers: PeerStatus[]) => void;
  setMyPeerId: (id: string | null) => void;
  setStats: (stats: StorageStats) => void;
}

export const useAppStore = create<AppState>((set) => ({
  rootHash: null,
  entries: [],
  peerCount: 0,
  peers: [],
  myPeerId: null,
  stats: { items: 0, bytes: 0 },

  setRootHash: (hash) => set({ rootHash: hash }),
  setEntries: (newEntries) => set((state) => {
    const sorted = [...newEntries].sort((a, b) => {
      // Directories first, then files, alphabetically within each group
      if (a.isTree !== b.isTree) return a.isTree ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    // Skip update if entries haven't changed (prevent unnecessary re-renders)
    if (state.entries.length === sorted.length) {
      let same = true;
      for (let i = 0; i < sorted.length; i++) {
        const oldE = state.entries[i];
        const newE = sorted[i];
        // Compare by name and hash bytes
        if (oldE.name !== newE.name ||
            oldE.isTree !== newE.isTree ||
            oldE.size !== newE.size ||
            !hashesEqual(oldE.hash, newE.hash)) {
          same = false;
          break;
        }
      }
      if (same) {
        return state; // Return existing state - no update needed
      }
    }

    return { entries: sorted };
  }),
  setPeerCount: (count) => set({ peerCount: count }),
  setPeers: (peers) => set({ peers }),
  setMyPeerId: (id) => set({ myPeerId: id }),
  setStats: (stats) => set({ stats }),
}));

// Expose for debugging in tests
if (typeof window !== 'undefined') {
  (window as any).__appStore = useAppStore;
  (window as any).__idbStore = idbStore;
}

// Format bytes
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// Update storage stats from IndexedDB
export async function updateStorageStats(): Promise<void> {
  try {
    const items = await idbStore.count();
    const bytes = await idbStore.totalBytes();
    useAppStore.getState().setStats({ items, bytes });
  } catch {
    // Ignore errors
  }
}

// Decode content as text
export function decodeAsText(data: Uint8Array): string | null {
  if (data.length === 0) return '';
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(data);
    if (!/[\x00-\x08\x0E-\x1F]/.test(text.slice(0, 1000))) {
      return text;
    }
  } catch {}
  return null;
}

// Get current directory path from URL (excludes file if selected)
function getCurrentPathFromUrl(): string[] {
  const hashPath = window.location.hash.slice(2); // Remove #/
  const parts = hashPath.split('/').filter(Boolean).map(decodeURIComponent);

  // Hash route: #/h/hash/path...
  let urlPath: string[] = [];
  if (parts[0] === 'h' && parts[1]) {
    urlPath = parts.slice(2);
  } else if (parts[0]?.startsWith('npub') && parts[1]) {
    // Tree route: #/npub/treeName/path...
    // Skip 'stream' as it's a special view route, not a path
    const pathParts = parts.slice(2);
    urlPath = pathParts[0] === 'stream' ? [] : pathParts;
  }

  if (urlPath.length === 0) return [];

  // Check if last segment is a file in current entries
  const entries = useAppStore.getState().entries;
  const lastSegment = urlPath[urlPath.length - 1];
  const isFile = entries.some(e => e.name === lastSegment && !e.isTree);
  return isFile ? urlPath.slice(0, -1) : urlPath;
}

// Get current directory hash from URL path
export async function getCurrentDirHash(): Promise<Hash | null> {
  const state = useAppStore.getState();
  if (!state.rootHash) return null;

  const currentPath = getCurrentPathFromUrl();
  if (currentPath.length === 0) return state.rootHash;

  let hash = state.rootHash;
  for (const part of currentPath) {
    const resolved = await _tree.resolvePath(hash, part);
    if (!resolved) return null;
    hash = resolved;
  }
  return hash;
}

// Refresh current directory
export async function refreshDirectory() {
  const hash = await getCurrentDirHash();
  if (hash) {
    const list = await _tree.listDirectory(hash);
    useAppStore.getState().setEntries(list);
  }
}

// Initialize WebRTC store with signer and pubkey
export function initWebRTC(
  signer: EventSigner,
  pubkey: string,
  encrypt: EventEncrypter,
  decrypt: EventDecrypter,
) {
  if (webrtcStore) {
    webrtcStore.stop();
  }

  webrtcStore = new WebRTCStore({
    signer,
    pubkey,
    encrypt,
    decrypt,
    localStore: idbStore,
    satisfiedConnections: 3,
    maxConnections: 6,
    debug: true,
  });

  _tree = new HashTree({ store: webrtcStore, chunkSize: 1024 });

  webrtcStore.on((event) => {
    if (event.type === 'update') {
      useAppStore.getState().setPeerCount(webrtcStore?.getConnectedCount() ?? 0);
      useAppStore.getState().setPeers(webrtcStore?.getPeers() ?? []);
    }
  });

  useAppStore.getState().setMyPeerId(webrtcStore.getMyPeerId());
  webrtcStore.start();
}

// Stop WebRTC store
export function stopWebRTC() {
  if (webrtcStore) {
    webrtcStore.stop();
    webrtcStore = null;
    useAppStore.getState().setPeerCount(0);
    useAppStore.getState().setPeers([]);
    useAppStore.getState().setMyPeerId(null);
    _tree = new HashTree({ store: idbStore, chunkSize: 1024 });
  }
}

// Get WebRTC store for P2P fetching
export function getWebRTCStore(): WebRTCStore | null {
  return webrtcStore;
}
