/**
 * Worker Initialization
 *
 * Initializes the hashtree worker for offloading storage and networking
 * from the main thread.
 */

import { initWorkerAdapter, getWorkerAdapter } from '../workerAdapter';
import { DEFAULT_NETWORK_SETTINGS } from '../stores/settings';
import { refreshWebRTCStats } from '../store';

// Import worker with Vite's ?worker query
import HashTreeWorker from '../workers/hashtree.worker?worker';

let initialized = false;

export interface WorkerInitIdentity {
  pubkey: string;
  nsec?: string;  // hex-encoded secret key (only for nsec login)
}

/**
 * Initialize the hashtree worker with user identity.
 * Safe to call multiple times - only initializes once.
 */
export async function initHashtreeWorker(identity: WorkerInitIdentity): Promise<void> {
  if (initialized) return;

  try {
    console.log('[WorkerInit] Starting hashtree worker...');

    await initWorkerAdapter(HashTreeWorker, {
      storeName: 'hashtree-worker',
      relays: DEFAULT_NETWORK_SETTINGS.relays,
      blossomServers: DEFAULT_NETWORK_SETTINGS.blossomServers,
      pubkey: identity.pubkey,
      nsec: identity.nsec,
    });

    initialized = true;
    console.log('[WorkerInit] Hashtree worker ready');

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
