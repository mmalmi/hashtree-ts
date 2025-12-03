/**
 * Shared state and store instances using zustand
 */
import { create } from 'zustand';
import {
  IndexedDBStore,
  HashTree,
  WebRTCStore,
  cid,
} from 'hashtree';
import type { CID, PeerStatus, EventSigner, EventEncrypter, EventDecrypter } from 'hashtree';

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
  rootCid: CID | null;

  // WebRTC state
  peerCount: number;
  peers: PeerStatus[];
  myPeerId: string | null;

  // Storage stats
  stats: StorageStats;

  // Actions
  setRootCid: (cid: CID | null) => void;
  setPeerCount: (count: number) => void;
  setPeers: (peers: PeerStatus[]) => void;
  setMyPeerId: (id: string | null) => void;
  setStats: (stats: StorageStats) => void;
}

export const useAppStore = create<AppState>((set) => ({
  rootCid: null,
  peerCount: 0,
  peers: [],
  myPeerId: null,
  stats: { items: 0, bytes: 0 },

  setRootCid: (rootCid) => set({ rootCid }),
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
