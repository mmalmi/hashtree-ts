/**
 * Worker Initialization
 * Shared initialization logic for the unified worker
 */
import { initWorkerAdapter } from '../workerAdapter';
import { initializeSocialGraph, setupSocialGraphSubscriptions } from '../utils/socialGraph';
import { get } from 'svelte/store';
import { settingsStore } from '../stores/settings';
// @ts-expect-error Vite worker import
import UnifiedWorker from '../workers/unified.worker?worker';

let initialized = false;
let initPromise: Promise<void> | null = null;

/**
 * Initialize the unified worker.
 * This is fire-and-forget - doesn't block UI rendering.
 */
export function initUnifiedWorker(): void {
  if (initialized || initPromise) return;

  initPromise = doInit();
  initPromise.catch(err => {
    console.error('[workerInit] Worker initialization failed:', err);
  });
}

async function doInit(): Promise<void> {
  const settings = get(settingsStore);
  const relays = settings.network?.relays || [
    'wss://relay.damus.io',
    'wss://relay.primal.net',
    'wss://nos.lol',
    'wss://temp.iris.to',
  ];

  await initWorkerAdapter(UnifiedWorker, {
    relays,
    storeName: 'hashtree-files',
  });
  console.log('[workerInit] Worker initialized');

  // Initialize social graph after worker is ready
  await initializeSocialGraph();
  await setupSocialGraphSubscriptions();
  console.log('[workerInit] SocialGraph initialized');

  initialized = true;
}
