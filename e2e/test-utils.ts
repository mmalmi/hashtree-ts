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
    const { webRTCStore } = await import('/src/store');
    if (webRTCStore) {
      webRTCStore.setPoolConfig({
        follows: { maxConnections: 20, satisfiedConnections: 10 },
        other: { maxConnections: 0, satisfiedConnections: 0 },
      });
    }
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
