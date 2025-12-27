/**
 * Worker Initialization
 *
 * Initializes the hashtree worker for offloading storage and networking
 * from the main thread.
 */

import { initWorkerAdapter, getWorkerAdapter } from '../workerAdapter';
import { DEFAULT_NETWORK_SETTINGS, settingsStore } from '../stores/settings';
import { refreshWebRTCStats } from '../store';
import { get } from 'svelte/store';
import { createFollowsStore, getFollowsSync } from '../stores/follows';
import { setupVersionCallback } from '../utils/socialGraph';
import { ndk } from '../nostr/ndk';
// Import worker using Vite's ?worker query - returns a Worker constructor
import HashtreeWorker from '../workers/hashtree.worker.ts?worker';

let initialized = false;
let lastPoolConfigHash = '';
let lastFollowsHash = '';
let followsUnsubscribe: (() => void) | null = null;

/**
 * Sync pool settings from settings store to worker.
 * Uses a hash to avoid duplicate updates.
 */
function syncPoolSettings(): void {
  const adapter = getWorkerAdapter();
  if (!adapter) return;

  const settings = get(settingsStore);
  const poolConfig = {
    follows: { max: settings.pools.followsMax, satisfied: settings.pools.followsSatisfied },
    other: { max: settings.pools.otherMax, satisfied: settings.pools.otherSatisfied },
  };

  // Hash to avoid duplicate updates
  const configHash = JSON.stringify(poolConfig);
  if (configHash === lastPoolConfigHash) return;
  lastPoolConfigHash = configHash;

  console.log('[WorkerInit] Syncing pool settings to worker:', poolConfig);
  adapter.setWebRTCPools(poolConfig);
}

/**
 * Sync follows list to worker for WebRTC peer classification.
 */
async function syncFollows(follows: string[]): Promise<void> {
  const adapter = getWorkerAdapter();
  if (!adapter) return;

  // Hash to avoid duplicate updates
  const followsHash = follows.join(',');
  if (followsHash === lastFollowsHash) return;
  lastFollowsHash = followsHash;

  console.log('[WorkerInit] Syncing follows to worker:', follows.length, 'pubkeys');
  await adapter.setFollows(follows);
}

// Track follows store for cleanup
let followsStoreDestroy: (() => void) | null = null;

/**
 * Set up follows subscription for the current user.
 */
function setupFollowsSubscription(pubkey: string): void {
  // Clean up previous subscription
  if (followsUnsubscribe) {
    followsUnsubscribe();
    followsUnsubscribe = null;
  }
  if (followsStoreDestroy) {
    followsStoreDestroy();
    followsStoreDestroy = null;
  }

  // Sync current follows if available
  const currentFollows = getFollowsSync(pubkey);
  if (currentFollows) {
    syncFollows(currentFollows.follows);
  }

  // Create follows store and subscribe to changes
  const followsStore = createFollowsStore(pubkey);
  followsStoreDestroy = followsStore.destroy;
  followsUnsubscribe = followsStore.subscribe((follows) => {
    if (follows) {
      syncFollows(follows.follows);
    }
  });
}

export interface WorkerInitIdentity {
  pubkey: string;
  nsec?: string;  // hex-encoded secret key (only for nsec login)
}

/**
 * Wait for service worker to be ready (needed for COOP/COEP headers)
 */
async function waitForServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;

  try {
    // Wait for service worker to be ready
    await navigator.serviceWorker.ready;
  } catch {
    // Service worker not available, continue anyway
  }
}

/**
 * Initialize the hashtree worker with user identity.
 * Safe to call multiple times - only initializes once.
 */
export async function initHashtreeWorker(identity: WorkerInitIdentity): Promise<void> {
  if (initialized) return;

  try {
    // Wait for service worker to be ready before loading workers
    // This ensures COOP/COEP headers are in place
    await waitForServiceWorker();

    console.log('[WorkerInit] Starting hashtree worker...');

    await initWorkerAdapter(HashtreeWorker, {
      storeName: 'hashtree-worker',
      relays: DEFAULT_NETWORK_SETTINGS.relays,
      blossomServers: DEFAULT_NETWORK_SETTINGS.blossomServers,
      pubkey: identity.pubkey,
      nsec: identity.nsec,
    });

    initialized = true;
    console.log('[WorkerInit] Hashtree worker ready');

    // Register worker as transport plugin for NDK publishes
    const adapter = getWorkerAdapter();
    if (adapter) {
      ndk.transportPlugins.push({
        name: 'worker',
        onPublish: async (event) => {
          // Route publish through worker (which has relay connections)
          await adapter.publish({
            id: event.id!,
            pubkey: event.pubkey,
            kind: event.kind!,
            content: event.content,
            tags: event.tags,
            created_at: event.created_at!,
            sig: event.sig!,
          });
        },
      });
      console.log('[WorkerInit] Registered worker transport plugin for NDK');
    }

    // Set up social graph version callback
    setupVersionCallback();

    // Sync pool settings from settings store to worker
    // Need to wait for settings to load from IndexedDB if not already loaded
    const settings = get(settingsStore);
    if (settings.poolsLoaded) {
      syncPoolSettings();
    }

    // Subscribe to pool settings changes to keep worker in sync
    // This handles both initial load and subsequent changes
    settingsStore.subscribe(state => {
      if (state.poolsLoaded && initialized) {
        syncPoolSettings();
      }
    });

    // Set up follows subscription for WebRTC peer classification
    setupFollowsSubscription(identity.pubkey);

    // Start periodic peer stats polling for connectivity indicator
    refreshWebRTCStats();
    setInterval(refreshWebRTCStats, 2000);
  } catch (err) {
    console.error('[WorkerInit] Failed to initialize worker:', err);
    // Don't throw - app can still work without worker (fallback to main thread)
  }
}

/**
 * Check if the worker is initialized and ready.
 */
export function isWorkerReady(): boolean {
  return initialized && getWorkerAdapter() !== null;
}

// Re-export for convenience
export { getWorkerAdapter } from '../workerAdapter';
