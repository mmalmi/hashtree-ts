/**
 * Worker Initialization
 *
 * Initializes the hashtree worker for offloading storage and networking
 * from the main thread.
 */

import { initWorkerAdapter, getWorkerAdapter } from '../workerAdapter';
import { DEFAULT_NETWORK_SETTINGS } from '../stores/settings';
import { refreshWebRTCStats } from '../store';

// Worker URL for Vite - using recommended new URL() approach
const workerUrl = new URL('../workers/hashtree.worker.ts', import.meta.url);

let initialized = false;

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

    await initWorkerAdapter(workerUrl, {
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
