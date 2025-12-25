/**
 * Shared test utilities for e2e tests
 */

import { expect } from '@playwright/test';

/**
 * Filter out noisy errors from relays that are irrelevant to tests.
 * - rate-limited: Some relays rate-limit nostr events
 * - pow: Some relays require Proof of Work on events (e.g., "pow: 28 bits needed")
 */
export function setupPageErrorHandler(page: any) {
  page.on('pageerror', (err: Error) => {
    const msg = err.message;
    if (!msg.includes('rate-limited') && !msg.includes('pow:') && !msg.includes('bits needed')) {
      console.log('Page error:', msg);
    }
  });
}

/**
 * Wait for the app to be ready (header visible).
 * Call this after page.reload() before calling disableOthersPool or configureBlossomServers.
 */
export async function waitForAppReady(page: any) {
  await expect(page.locator('header').first()).toBeVisible({ timeout: 30000 });
}

/**
 * Wait for new user setup to complete and navigate to public folder.
 * New users get three default folders created (public, link, private).
 * This function waits for setup, then clicks into the public folder.
 */
export async function navigateToPublicFolder(page: any) {
  // First wait for the app to be ready - look for the Iris header
  await expect(page.locator('header').first()).toBeVisible({ timeout: 30000 });

  // Wait for the public folder link to appear in the tree list (indicates setup complete)
  // This can take a while for new users since default folders are created async
  // and published to Nostr fire-and-forget style
  const publicLink = page.getByRole('link', { name: 'public' }).first();

  // Wait for public folder to appear
  await expect(publicLink).toBeVisible({ timeout: 30000 });

  // Click into the public folder
  await publicLink.click();

  // Wait for navigation to complete and folder actions to be visible
  await page.waitForURL(/\/#\/npub.*\/public/, { timeout: 15000 });
  await expect(page.getByRole('button', { name: /File/ }).first()).toBeVisible({ timeout: 10000 });
}

/**
 * Navigate to user's tree list (home/root).
 * Clicks the logo in the header which links to home.
 */
export async function goToTreeList(page: any) {
  // Click the hashtree logo to go home
  await page.locator('header a:has-text("Iris")').click();
  // Wait for tree list to be visible
  await page.waitForTimeout(500);
}

/**
 * Disable the "others pool" for WebRTC connections.
 * This prevents the app from connecting to random peers from other parallel tests.
 * Use this for single-user tests that don't need WebRTC connections but might be
 * affected by incoming data from parallel test instances.
 *
 * IMPORTANT: Call this BEFORE any navigation or state changes in the test.
 */
export async function disableOthersPool(page: any) {
  await page.evaluate(async () => {
    // Import the settings store and set othersMax to 0
    const { settingsStore } = await import('/src/stores/settings');
    settingsStore.setPoolSettings({ otherMax: 0, otherSatisfied: 0 });

    // Update the worker's WebRTC pool config
    const { getWorkerAdapter } = await import('/src/workerAdapter');
    const adapter = getWorkerAdapter();
    adapter?.setWebRTCPools({
      follows: { max: 20, satisfied: 10 },
      other: { max: 0, satisfied: 0 },
    });
  });
}

/**
 * Enable the "others pool" for WebRTC connections.
 * Use this for tests that need same-user cross-device sync (same account on two browsers).
 * In test mode, the others pool is disabled by default to prevent interference.
 *
 * Sets a high limit (100) to avoid being blocked by parallel test connections.
 *
 * IMPORTANT: Call this AFTER login but BEFORE operations that need WebRTC.
 */
export async function enableOthersPool(page: any) {
  await page.evaluate(async () => {
    const { settingsStore } = await import('/src/stores/settings');
    settingsStore.setPoolSettings({ otherMax: 10, otherSatisfied: 2, followsMax: 20, followsSatisfied: 10 });

    // Update the worker's WebRTC pool config
    const { getWorkerAdapter } = await import('/src/workerAdapter');
    const adapter = getWorkerAdapter();
    adapter?.setWebRTCPools({
      follows: { max: 20, satisfied: 10 },
      other: { max: 10, satisfied: 2 },
    });
  });
}

/**
 * Pre-set pool settings in IndexedDB before page load/reload.
 * This ensures WebRTC initializes with correct pool limits since it starts
 * before enableOthersPool can be called.
 *
 * IMPORTANT: Call this BEFORE reload when you need others pool enabled on init.
 */
export async function presetOthersPoolInDB(page: any) {
  await page.evaluate(async () => {
    const request = indexedDB.open('hashtree-settings', 1);
    await new Promise<void>((resolve, reject) => {
      request.onerror = () => reject(request.error);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('settings', 'readwrite');
        const store = tx.objectStore('settings');
        store.put({
          key: 'pools',
          value: {
            followsMax: 20,
            followsSatisfied: 10,
            otherMax: 10,
            otherSatisfied: 2
          }
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  });
}

/**
 * Configure the app to use the local test relay instead of public relays.
 * This eliminates network flakiness and rate limiting issues during tests.
 *
 * Updates both settings store (for future store creations) and the
 * existing WebRTC store (for immediate effect on current connections).
 */
export async function useLocalRelay(page: any) {
  await page.evaluate(async () => {
    const localRelay = 'ws://localhost:4736';

    // Update settings store for future store creations
    const { settingsStore } = await import('/src/stores/settings');
    settingsStore.setNetworkSettings({
      relays: [localRelay],
    });

    // Also update the running WebRTC store if it exists
    // Use window global which is always in sync with the app
    const store = (window as unknown as { webrtcStore?: { setRelays?: (relays: string[]) => void } }).webrtcStore;
    if (store && typeof store.setRelays === 'function') {
      store.setRelays([localRelay]);
    }
  });
}

/**
 * Configure Blossom servers for tests that need them.
 * By default, test mode disables Blossom servers to avoid external HTTP requests.
 * Call this for tests that specifically test Blossom functionality.
 *
 * Uses a global function exposed by the settings module to avoid Vite module duplication issues.
 */
export async function configureBlossomServers(page: any) {
  await page.evaluate(() => {
    const configure = (window as unknown as { __configureBlossomServers?: (servers: unknown[]) => void }).__configureBlossomServers;
    if (!configure) {
      throw new Error('__configureBlossomServers not found - settings module may not be loaded');
    }
    configure([
      { url: 'https://cdn.iris.to', read: true, write: false },
      { url: 'https://hashtree.iris.to', read: true, write: true },
    ]);
  });
}

/**
 * Helper to follow a user by their npub.
 * Navigates to target's profile and clicks Follow, waiting for completion.
 * Use this to establish reliable WebRTC connections via the "follows pool".
 */
export async function followUser(page: any, targetNpub: string) {
  // Navigate to the user's profile page
  await page.goto(`http://localhost:5173/#/${targetNpub}`);

  // Click the Follow button
  const followButton = page.getByRole('button', { name: 'Follow', exact: true });
  await expect(followButton).toBeVisible({ timeout: 5000 });
  await followButton.click();

  // Wait for follow to complete - button becomes disabled or changes to "Following" or "Unfollow"
  await expect(
    page.getByRole('button', { name: 'Following' })
      .or(page.getByRole('button', { name: 'Unfollow' }))
      .or(followButton.and(page.locator('[disabled]')))
  ).toBeVisible({ timeout: 10000 });
}

/**
 * Wait for WebRTC connection to be established.
 * Polls until at least one peer is connected with data channel open.
 * Use this after users follow each other to ensure WebRTC is ready.
 */
export async function waitForWebRTCConnection(page: any, timeoutMs: number = 15000): Promise<boolean> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const result = await page.evaluate(async () => {
      // Use the window global which is always in sync with the app
      const adapter = (window as unknown as { __workerAdapter?: { getPeerStats: () => Promise<Array<{ connected?: boolean }>> } }).__workerAdapter;
      if (!adapter) return { hasAdapter: false, peerCount: 0, connected: false };
      try {
        const stats = await adapter.getPeerStats();
        const connectedCount = stats.filter((p: { connected?: boolean }) => p.connected).length;
        return { hasAdapter: true, peerCount: stats.length, connected: connectedCount > 0 };
      } catch (e) {
        return { hasAdapter: true, peerCount: 0, connected: false, error: String(e) };
      }
    });
    if (result.connected) {
      return true;
    }
    await page.waitForTimeout(500);
  }
  return false;
}
