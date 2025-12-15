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
 * Wait for new user setup to complete and navigate to public folder.
 * New users get three default folders created (public, link, private).
 * This function waits for setup, then clicks into the public folder.
 */
export async function navigateToPublicFolder(page: any) {
  // Wait for the public folder link to appear in the tree list (indicates setup complete)
  // This can take a while for new users since default folders are created async
  // and published to Nostr fire-and-forget style
  const publicLink = page.getByRole('link', { name: 'public' }).first();
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
  await page.locator('header a:has-text("hashtree")').click();
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
    // Note: Omit .ts extension for more robust Vite resolution
    const { settingsStore } = await import('/src/stores/settings');
    settingsStore.setPoolSettings({ otherMax: 0, otherSatisfied: 0 });

    // Also update the WebRTC store if it exists
    // Use window global which is always in sync with the app
    const store = (window as unknown as { webrtcStore?: { setPoolConfig: (config: unknown) => void } }).webrtcStore;
    if (store) {
      store.setPoolConfig({
        follows: { maxConnections: 20, satisfiedConnections: 10 },
        other: { maxConnections: 0, satisfiedConnections: 0 },
      });
    }
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
    // Use high limits to avoid parallel test interference
    settingsStore.setPoolSettings({ otherMax: 100, otherSatisfied: 1 });

    // Also update the WebRTC store if it exists
    // Use window global which is always in sync with the app
    const store = (window as unknown as { webrtcStore?: { setPoolConfig: (config: unknown) => void } }).webrtcStore;
    if (store) {
      store.setPoolConfig({
        follows: { maxConnections: 20, satisfiedConnections: 10 },
        other: { maxConnections: 100, satisfiedConnections: 1 },
      });
    }
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
        // Set high pool limits for cross-device sync
        store.put({
          key: 'pools',
          value: {
            followsMax: 20,
            followsSatisfied: 10,
            otherMax: 100,
            otherSatisfied: 1
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
 * IMPORTANT: Call this BEFORE any navigation or state changes in the test.
 */
export async function useLocalRelay(page: any) {
  await page.evaluate(async () => {
    const { settingsStore } = await import('/src/stores/settings');
    settingsStore.setNetworkSettings({
      relays: ['ws://localhost:4736'],
    });
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
      { url: 'https://files.iris.to', read: true, write: false },
      { url: 'https://hashtree.iris.to', read: false, write: true },
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
