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
