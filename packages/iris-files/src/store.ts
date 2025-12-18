/**
 * Shared state and store instances using Svelte stores
 */
import { writable, get } from 'svelte/store';
import {
  HashTree,
  WebRTCStore,
  LinkType,
} from 'hashtree';
import type { PeerStatus, EventSigner, EventEncrypter, EventDecrypter, GiftWrapper, GiftUnwrapper, PeerClassifier, BlossomSigner, WebRTCStats, PeerPool } from 'hashtree';

// Re-export LinkType for e2e tests that can't import 'hashtree' directly
export { LinkType };
import { socialGraphStore, getFollows, getFollowers, isFollowing } from './utils/socialGraph';
import { settingsStore, DEFAULT_POOL_SETTINGS, DEFAULT_NETWORK_SETTINGS } from './stores/settings';
import { nostrStore } from './nostr';
import { blossomLogStore } from './stores/blossomLog';
import { BlossomStore, DexieStore } from 'hashtree';

// Store instances - using Dexie/IndexedDB for file storage (better iOS Safari support)
export const localStore = new DexieStore('hashtree-explorer');

// HashTree instance - single class for all tree operations
let _tree = new HashTree({ store: localStore });

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

// Per-peer stats
export interface PeerStatsInfo {
  pubkey: string;
  pool: PeerPool;
  stats: {
    requestsSent: number;
    requestsReceived: number;
    responsesSent: number;
    responsesReceived: number;
    receiveErrors: number;
    bytesSent: number;
    bytesReceived: number;
    bytesForwarded: number;
  };
}

// Bandwidth tracking (rolling 5-second window)
const BANDWIDTH_WINDOW_MS = 5000;
let bandwidthSamples: { timestamp: number; bytesSent: number; bytesReceived: number }[] = [];
let lastBytesSent = 0;
let lastBytesReceived = 0;

// Lifetime transfer stats (persisted to localStorage)
const LIFETIME_STATS_KEY = 'hashtree:lifetimeStats';
interface LifetimeStats {
  bytesSent: number;
  bytesReceived: number;
  bytesForwarded: number;
  lastSessionBytesSent: number;
  lastSessionBytesReceived: number;
  lastSessionBytesForwarded: number;
}

function loadLifetimeStats(): LifetimeStats {
  try {
    const stored = localStorage.getItem(LIFETIME_STATS_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {}
  return {
    bytesSent: 0,
    bytesReceived: 0,
    bytesForwarded: 0,
    lastSessionBytesSent: 0,
    lastSessionBytesReceived: 0,
    lastSessionBytesForwarded: 0,
  };
}

let lifetimeStats = loadLifetimeStats();

function saveLifetimeStats(): void {
  try {
    localStorage.setItem(LIFETIME_STATS_KEY, JSON.stringify(lifetimeStats));
  } catch {}
}

// Update lifetime stats from current session stats
function updateLifetimeStats(sessionBytesSent: number, sessionBytesReceived: number, sessionBytesForwarded: number): void {
  // Add delta since last update
  const deltaSent = sessionBytesSent - lifetimeStats.lastSessionBytesSent;
  const deltaReceived = sessionBytesReceived - lifetimeStats.lastSessionBytesReceived;
  const deltaForwarded = sessionBytesForwarded - lifetimeStats.lastSessionBytesForwarded;

  if (deltaSent > 0) lifetimeStats.bytesSent += deltaSent;
  if (deltaReceived > 0) lifetimeStats.bytesReceived += deltaReceived;
  if (deltaForwarded > 0) lifetimeStats.bytesForwarded += deltaForwarded;

  lifetimeStats.lastSessionBytesSent = sessionBytesSent;
  lifetimeStats.lastSessionBytesReceived = sessionBytesReceived;
  lifetimeStats.lastSessionBytesForwarded = sessionBytesForwarded;

  saveLifetimeStats();
}

export function getLifetimeStats(): { bytesSent: number; bytesReceived: number; bytesForwarded: number } {
  return {
    bytesSent: lifetimeStats.bytesSent,
    bytesReceived: lifetimeStats.bytesReceived,
    bytesForwarded: lifetimeStats.bytesForwarded,
  };
}

// WebSocket fallback status
// App state store interface
interface AppState {
  // WebRTC state
  peerCount: number;
  peers: PeerStatus[];
  myPeerId: string | null;
  fallbackStoresCount: number;

  // WebRTC stats
  webrtcStats: WebRTCStats | null;
  perPeerStats: Map<string, PeerStatsInfo>;

  // Bandwidth (bytes per second, rolling average)
  uploadBandwidth: number;
  downloadBandwidth: number;

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
    webrtcStats: null,
    perPeerStats: new Map(),
    uploadBandwidth: 0,
    downloadBandwidth: 0,
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

    setWebRTCStats: (
      webrtcStats: WebRTCStats | null,
      perPeerStats: Map<string, PeerStatsInfo>
    ) => {
      // Calculate bandwidth from rolling window
      let uploadBandwidth = 0;
      let downloadBandwidth = 0;

      if (webrtcStats) {
        const now = Date.now();
        const currentBytesSent = webrtcStats.bytesSent;
        const currentBytesReceived = webrtcStats.bytesReceived;

        // Add new sample (delta since last)
        if (lastBytesSent > 0 || lastBytesReceived > 0) {
          bandwidthSamples.push({
            timestamp: now,
            bytesSent: currentBytesSent - lastBytesSent,
            bytesReceived: currentBytesReceived - lastBytesReceived,
          });
        }

        // Update last values
        lastBytesSent = currentBytesSent;
        lastBytesReceived = currentBytesReceived;

        // Remove samples older than window
        const cutoff = now - BANDWIDTH_WINDOW_MS;
        bandwidthSamples = bandwidthSamples.filter(s => s.timestamp > cutoff);

        // Calculate average bandwidth (bytes per second)
        if (bandwidthSamples.length > 0) {
          const totalSent = bandwidthSamples.reduce((sum, s) => sum + s.bytesSent, 0);
          const totalReceived = bandwidthSamples.reduce((sum, s) => sum + s.bytesReceived, 0);
          const windowSeconds = BANDWIDTH_WINDOW_MS / 1000;
          uploadBandwidth = totalSent / windowSeconds;
          downloadBandwidth = totalReceived / windowSeconds;
        }

        // Persist lifetime stats
        updateLifetimeStats(webrtcStats.bytesSent, webrtcStats.bytesReceived, webrtcStats.bytesForwarded);
      }

      update(state => ({ ...state, webrtcStats, perPeerStats, uploadBandwidth, downloadBandwidth }));
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

/**
 * Create peer classifier using social graph
 * Returns 'follows' for users we follow or who follow us
 * Returns 'other' for everyone else
 *
 * Uses isFollowing() which works immediately after handleEvent(),
 * unlike getFollowDistance() which requires recalculation.
 */
function createPeerClassifier(): PeerClassifier {
  return (pubkey: string) => {
    const myPubkey = get(nostrStore).pubkey;
    if (!myPubkey) {
      return 'other';
    }

    // Check if we follow them OR they follow us (sync, uses cache)
    const weFollowThem = isFollowing(myPubkey, pubkey);
    const theyFollowUs = isFollowing(pubkey, myPubkey);

    if (weFollowThem || theyFollowUs) {
      return 'follows';
    }
    return 'other';
  };
}

/**
 * Get pubkeys of users we follow or who follow us
 * Used to filter hello subscriptions when others pool is disabled
 */
function getFollowedPubkeys(): string[] {
  const myPubkey = get(nostrStore).pubkey;
  if (!myPubkey) return [];

  const follows = getFollows(myPubkey);
  const followers = getFollowers(myPubkey);

  // Combine and deduplicate
  const combined = new Set([...follows, ...followers]);
  return Array.from(combined);
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
  giftWrap: GiftWrapper,
  giftUnwrap: GiftUnwrapper,
) {
  if (webrtcStore) {
    webrtcStore.stop();
  }

  // Get network settings (relays for WebRTC, blossom servers for fallback)
  const networkSettings = get(settingsStore).network;
  const relays = networkSettings?.relays?.length > 0
    ? networkSettings.relays
    : DEFAULT_NETWORK_SETTINGS.relays;
  const blossomServers = networkSettings?.blossomServers?.length > 0
    ? networkSettings.blossomServers
    : DEFAULT_NETWORK_SETTINGS.blossomServers;

  webrtcStore = new WebRTCStore({
    signer,
    pubkey,
    encrypt,
    decrypt,
    giftWrap,
    giftUnwrap,
    localStore: localStore,
    debug: true,
    relays,
    // Pool-based peer management
    peerClassifier: createPeerClassifier(),
    pools: getPoolConfigFromSettings(),
    // Function to get followed pubkeys for subscription filtering
    // When others pool is disabled, only subscribe to hellos from these pubkeys
    getFollowedPubkeys,
    // Fallback to Blossom HTTP server when WebRTC peers don't have the data
    // Pass signer so writes can be authenticated (NIP-98)
    fallbackStores: [new BlossomStore({
      servers: blossomServers,
      signer: signer as BlossomSigner,
      logger: (entry) => blossomLogStore.add(entry),
    })],
  });

  _tree = new HashTree({ store: webrtcStore });

  webrtcStore.on((event) => {
    if (event.type === 'update') {
      appStore.setPeerCount(webrtcStore?.getConnectedCount() ?? 0);
      appStore.setPeers(webrtcStore?.getPeers() ?? []);
      appStore.setFallbackStoresCount(webrtcStore?.getFallbackStoresCount() ?? 0);

      // Update stats
      if (webrtcStore) {
        const { aggregate, perPeer } = webrtcStore.getStats();
        appStore.setWebRTCStats(aggregate, perPeer);
      }
    }
  });

  // Update peer classifier and hello subscription when social graph changes
  const unsubSocialGraph = socialGraphStore.subscribe(() => {
    if (webrtcStore) {
      webrtcStore.setPeerClassifier(createPeerClassifier());
      // Also update hello subscription in case follows list changed
      // (when others pool is disabled, we only subscribe to followed users)
      webrtcStore.updateHelloSubscription();
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
    _tree = new HashTree({ store: localStore });
  }
}

// Get WebRTC store for P2P fetching
export function getWebRTCStore(): WebRTCStore | null {
  return webrtcStore;
}

// Refresh WebRTC stats (call periodically to update UI)
export function refreshWebRTCStats(): void {
  if (webrtcStore) {
    const { aggregate, perPeer } = webrtcStore.getStats();
    appStore.setWebRTCStats(aggregate, perPeer);
  }
}
