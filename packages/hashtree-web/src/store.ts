/**
 * Shared state and store instances using zustand
 */
import { create } from 'zustand';
import {
  IndexedDBStore,
  HashTree,
  WebRTCStore,
} from 'hashtree';
import type { PeerStatus, EventSigner, EventEncrypter, EventDecrypter, PeerClassifier } from 'hashtree';
import { getSocialGraph, useSocialGraphStore } from './utils/socialGraph';
import { useSettingsStore, DEFAULT_POOL_SETTINGS } from './stores/settings';

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

// WebSocket fallback status
export interface WsFallbackStatus {
  url: string | null;
  connected: boolean;
}

// App state store
// Note: rootCid is now derived from URL via useTreeRoot hook (see hooks/useTreeRoot.ts)
interface AppState {
  // WebRTC state
  peerCount: number;
  peers: PeerStatus[];
  myPeerId: string | null;
  wsFallback: WsFallbackStatus;

  // Storage stats
  stats: StorageStats;

  // Actions
  setPeerCount: (count: number) => void;
  setPeers: (peers: PeerStatus[]) => void;
  setMyPeerId: (id: string | null) => void;
  setWsFallback: (status: WsFallbackStatus) => void;
  setStats: (stats: StorageStats) => void;
}

export const useAppStore = create<AppState>((set) => ({
  peerCount: 0,
  peers: [],
  myPeerId: null,
  wsFallback: { url: null, connected: false },
  stats: { items: 0, bytes: 0 },

  setPeerCount: (count) => set({ peerCount: count }),
  setPeers: (peers) => set({ peers }),
  setMyPeerId: (id) => set({ myPeerId: id }),
  setWsFallback: (status) => set({ wsFallback: status }),
  setStats: (stats) => set({ stats }),
}));

// Expose for debugging in tests
if (typeof window !== 'undefined') {
  const win = window as Window & { __appStore?: typeof useAppStore; __idbStore?: typeof idbStore };
  win.__appStore = useAppStore;
  win.__idbStore = idbStore;
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

/**
 * Create peer classifier using social graph
 * Returns 'follows' for users we follow or who follow us (distance <= 1)
 * Returns 'other' for everyone else
 */
function createPeerClassifier(): PeerClassifier {
  return (pubkey: string) => {
    const graph = getSocialGraph();
    if (!graph) return 'other';

    const distance = graph.getFollowDistance(pubkey);
    // Distance 0 = self, 1 = we follow them or they follow us
    if (distance <= 1) {
      return 'follows';
    }
    return 'other';
  };
}

/**
 * Get pool config from settings store
 */
function getPoolConfigFromSettings() {
  const settings = useSettingsStore.getState();
  const pools = settings.poolsLoaded ? settings.pools : DEFAULT_POOL_SETTINGS;
  return {
    follows: { maxConnections: pools.followsMax, satisfiedConnections: pools.followsSatisfied },
    other: { maxConnections: pools.otherMax, satisfiedConnections: pools.otherSatisfied },
  };
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
    debug: true,
    // Pool-based peer management
    peerClassifier: createPeerClassifier(),
    pools: getPoolConfigFromSettings(),
  });

  _tree = new HashTree({ store: webrtcStore, chunkSize: 1024 });

  webrtcStore.on((event) => {
    if (event.type === 'update') {
      useAppStore.getState().setPeerCount(webrtcStore?.getConnectedCount() ?? 0);
      useAppStore.getState().setPeers(webrtcStore?.getPeers() ?? []);
      useAppStore.getState().setWsFallback(webrtcStore?.getWsFallbackStatus() ?? { url: null, connected: false });
    }
  });

  // Update peer classifier when social graph changes
  useSocialGraphStore.subscribe(() => {
    if (webrtcStore) {
      webrtcStore.setPeerClassifier(createPeerClassifier());
    }
  });

  // Update pool config when settings change
  useSettingsStore.subscribe((state, prevState) => {
    if (webrtcStore && state.pools !== prevState.pools) {
      webrtcStore.setPoolConfig(getPoolConfigFromSettings());
    }
  });

  useAppStore.getState().setMyPeerId(webrtcStore.getMyPeerId());
  useAppStore.getState().setWsFallback(webrtcStore.getWsFallbackStatus());
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
    useAppStore.getState().setWsFallback({ url: null, connected: false });
    _tree = new HashTree({ store: idbStore, chunkSize: 1024 });
  }
}

// Get WebRTC store for P2P fetching
export function getWebRTCStore(): WebRTCStore | null {
  return webrtcStore;
}
