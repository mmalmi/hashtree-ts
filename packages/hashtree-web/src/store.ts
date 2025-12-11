/**
 * Shared state and store instances using Svelte stores
 */
import { writable, get } from 'svelte/store';
import {
  HashTree,
  WebRTCStore,
  LinkType,
} from 'hashtree';
import type { PeerStatus, EventSigner, EventEncrypter, EventDecrypter, PeerClassifier } from 'hashtree';

// Re-export LinkType for e2e tests that can't import 'hashtree' directly
export { LinkType };
import { getSocialGraph, socialGraphStore } from './utils/socialGraph';
import { settingsStore, DEFAULT_POOL_SETTINGS } from './stores/settings';
import { DexieStore } from 'hashtree-dexie';
import { BlossomStore } from 'hashtree';

// Store instances - using Dexie for more robust IndexedDB handling
export const idbStore = new DexieStore('hashtree-explorer');

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
// App state store interface
interface AppState {
  // WebRTC state
  peerCount: number;
  peers: PeerStatus[];
  myPeerId: string | null;
  fallbackStoresCount: number;

  // Storage stats
  stats: StorageStats;
}

// Create Svelte store for app state
function createAppStore() {
  const { subscribe, update } = writable<AppState>({
    peerCount: 0,
    peers: [],
    myPeerId: null,
    fallbackStoresCount: 0,
    stats: { items: 0, bytes: 0 },
  });

  return {
    subscribe,

    setPeerCount: (count: number) => {
      update(state => ({ ...state, peerCount: count }));
    },

    setPeers: (peers: PeerStatus[]) => {
      update(state => ({ ...state, peers }));
    },

    setMyPeerId: (id: string | null) => {
      update(state => ({ ...state, myPeerId: id }));
    },

    setFallbackStoresCount: (count: number) => {
      update(state => ({ ...state, fallbackStoresCount: count }));
    },

    setStats: (stats: StorageStats) => {
      update(state => ({ ...state, stats }));
    },

    // Get current state synchronously (for compatibility)
    getState: (): AppState => get(appStore),
  };
}

export const appStore = createAppStore();

// Legacy compatibility alias
export const useAppStore = appStore;

// Expose for debugging in tests
if (typeof window !== 'undefined') {
  const win = window as Window & { __appStore?: typeof appStore; __idbStore?: typeof idbStore };
  win.__appStore = appStore;
  win.__idbStore = idbStore;
}

// Format bytes
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// Update storage stats from IDB
export async function updateStorageStats(): Promise<void> {
  try {
    const items = await idbStore.count();
    const bytes = await idbStore.totalBytes();
    appStore.setStats({ items, bytes });
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
  const settings = get(settingsStore);
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
    // Fallback to Blossom HTTP server when WebRTC peers don't have the data
    fallbackStores: [new BlossomStore({ servers: ['https://hashtree.iris.to'] })],
  });

  _tree = new HashTree({ store: webrtcStore, chunkSize: 1024 });

  webrtcStore.on((event) => {
    if (event.type === 'update') {
      appStore.setPeerCount(webrtcStore?.getConnectedCount() ?? 0);
      appStore.setPeers(webrtcStore?.getPeers() ?? []);
      appStore.setFallbackStoresCount(webrtcStore?.getFallbackStoresCount() ?? 0);
    }
  });

  // Update peer classifier when social graph changes
  const unsubSocialGraph = socialGraphStore.subscribe(() => {
    if (webrtcStore) {
      webrtcStore.setPeerClassifier(createPeerClassifier());
    }
  });

  // Update pool config when settings change
  let prevPools = get(settingsStore).pools;
  const unsubSettings = settingsStore.subscribe((state) => {
    if (webrtcStore && state.pools !== prevPools) {
      webrtcStore.setPoolConfig(getPoolConfigFromSettings());
      prevPools = state.pools;
    }
  });

  // Store unsubscribe functions for cleanup
  (webrtcStore as WebRTCStore & { _unsubscribers?: (() => void)[] })._unsubscribers = [
    unsubSocialGraph,
    unsubSettings,
  ];

  appStore.setMyPeerId(webrtcStore.getMyPeerId());
  appStore.setFallbackStoresCount(webrtcStore.getFallbackStoresCount());
  webrtcStore.start();
}

// Stop WebRTC store
export function stopWebRTC() {
  if (webrtcStore) {
    // Cleanup subscriptions
    const store = webrtcStore as WebRTCStore & { _unsubscribers?: (() => void)[] };
    store._unsubscribers?.forEach(unsub => unsub());

    webrtcStore.stop();
    webrtcStore = null;
    appStore.setPeerCount(0);
    appStore.setPeers([]);
    appStore.setMyPeerId(null);
    appStore.setFallbackStoresCount(0);
    _tree = new HashTree({ store: idbStore, chunkSize: 1024 });
  }
}

// Get WebRTC store for P2P fetching
export function getWebRTCStore(): WebRTCStore | null {
  return webrtcStore;
}
