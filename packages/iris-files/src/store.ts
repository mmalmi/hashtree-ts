/**
 * Shared state and store instances using Svelte stores
 *
 * Storage architecture:
 * - WorkerStore: Primary storage, proxies to worker thread
 * - Worker owns: DexieStore (IndexedDB), Blossom fallback
 * - Main thread: UI coordination only
 */
import { writable, get } from 'svelte/store';
import { HashTree, LinkType } from 'hashtree';
import { getWorkerStore } from './stores/workerStore';
import { closeWorkerAdapter, getWorkerAdapter } from './workerAdapter';

// Re-export LinkType for e2e tests that can't import 'hashtree' directly
export { LinkType };

// Export localStore - always uses WorkerStore (no fallback)
// Worker MUST be initialized before using storage
export const localStore = {
  async put(hash: Uint8Array, data: Uint8Array): Promise<boolean> {
    return getWorkerStore().put(hash, data);
  },
  async get(hash: Uint8Array): Promise<Uint8Array | null> {
    return getWorkerStore().get(hash);
  },
  async has(hash: Uint8Array): Promise<boolean> {
    return getWorkerStore().has(hash);
  },
  async delete(hash: Uint8Array): Promise<boolean> {
    return getWorkerStore().delete(hash);
  },
  // Stats methods - TODO: implement in worker
  async count(): Promise<number> {
    return 0;
  },
  async totalBytes(): Promise<number> {
    return 0;
  },
};

// HashTree instance - uses localStore which routes to worker
const _tree = new HashTree({ store: localStore });

// Getter for tree - always returns current instance
export function getTree(): HashTree {
  return _tree;
}

// Storage stats
export interface StorageStats {
  items: number;
  bytes: number;
}

// Peer info for connectivity indicator
export interface PeerInfo {
  peerId: string;
  pubkey: string;
  state: 'connected' | 'disconnected';
  pool: 'follows' | 'others';
}

// App state store interface (simplified - WebRTC stats come from worker)
interface AppState {
  // Storage stats
  stats: StorageStats;
  // WebRTC peer count (from worker)
  peerCount: number;
  // Peer list for connectivity indicator
  peers: PeerInfo[];
}

// Create Svelte store for app state
function createAppStore() {
  const { subscribe, update } = writable<AppState>({
    stats: { items: 0, bytes: 0 },
    peerCount: 0,
    peers: [],
  });

  return {
    subscribe,

    setStats: (stats: StorageStats) => {
      update(state => ({ ...state, stats }));
    },

    setPeerCount: (count: number) => {
      update(state => ({ ...state, peerCount: count }));
    },

    setPeers: (peers: PeerInfo[]) => {
      update(state => ({ ...state, peers, peerCount: peers.filter(p => p.state === 'connected').length }));
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
  const win = window as Window & { __appStore?: typeof appStore; __localStore?: typeof localStore };
  win.__appStore = appStore;
  win.__localStore = localStore;
}

// Format bytes
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

// Format bandwidth (bytes per second)
export function formatBandwidth(bytesPerSecond: number): string {
  if (bytesPerSecond < 1) return '0 B/s';
  if (bytesPerSecond < 1024) return `${Math.round(bytesPerSecond)} B/s`;
  if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSecond / 1024 / 1024).toFixed(1)} MB/s`;
}

// Update storage stats from IDB
export async function updateStorageStats(): Promise<void> {
  try {
    const items = await localStore.count();
    const bytes = await localStore.totalBytes();
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

// Stub functions for compatibility - WebRTC is now in worker
// These are called from nostr.ts on login/logout

export function initWebRTC(): void {
  // WebRTC is handled by worker - nothing to do here
  console.log('[Store] WebRTC initialization delegated to worker');
}

export function stopWebRTC(): void {
  // Close worker (clears identity, stops WebRTC, Nostr)
  closeWorkerAdapter();
}

// Legacy exports for compatibility - WebRTC is now in worker
// Create a proxy object that forwards to worker for test compatibility
const webrtcStoreProxy = {
  getPeers: () => get(appStore).peers.map(p => ({
    ...p,
    isConnected: p.state === 'connected',
  })),
  getConnectedCount: () => get(appStore).peers.filter(p => p.state === 'connected').length,
  get: async (hash: string) => {
    const adapter = getWorkerAdapter();
    if (!adapter) return null;
    return adapter.get(hash);
  },
  setPoolConfig: (_config: unknown) => {
    // Pool config is managed by worker, no-op for now
  },
  setRelays: (_relays: string[]) => {
    // Relays are managed by worker, no-op for now
  },
  sendHello: () => {
    // Hello is automatic in worker
  },
};
export const webrtcStore = webrtcStoreProxy;
export function getWebRTCStore() { return webrtcStoreProxy; }
export function blockPeer(_pubkey: string): void {}
export function unblockPeer(_pubkey: string): void {}

// Expose webrtcStore on window for test compatibility
// Use defineProperty to allow testHelpers to override if needed
if (typeof window !== 'undefined' && !('webrtcStore' in window)) {
  Object.defineProperty(window, 'webrtcStore', {
    value: webrtcStoreProxy,
    writable: true,
    configurable: true,
  });
}

// Refresh WebRTC stats from worker
export async function refreshWebRTCStats(): Promise<void> {
  const adapter = getWorkerAdapter();
  if (!adapter) return;

  try {
    // Get current user's follows for pool classification
    const { getFollowsSync } = await import('./stores/follows');
    const { nostrStore } = await import('./nostr');
    const myPubkey = get(nostrStore).pubkey;
    const followsData = myPubkey ? getFollowsSync(myPubkey) : undefined;
    const followsSet = new Set(followsData?.follows || []);

    const stats = await adapter.getPeerStats();
    const peers: PeerInfo[] = stats.map(p => ({
      peerId: p.peerId,
      pubkey: p.pubkey,
      state: p.connected ? 'connected' : 'disconnected',
      pool: followsSet.has(p.pubkey) ? 'follows' : 'others',
    }));
    appStore.setPeers(peers);
  } catch {
    // Worker not ready or other error
  }
}

export function getLifetimeStats() {
  return { bytesSent: 0, bytesReceived: 0, bytesForwarded: 0 };
}
