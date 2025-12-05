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
 * Wait for new user redirect to complete.
 * New users get three default folders created (public, link, private)
 * and are redirected to /{npub}/public automatically.
 */
export async function waitForNewUserRedirect(page: any) {
  await page.waitForURL(/\/#\/npub.*\/public/, { timeout: 15000 });
  await expect(page.getByRole('button', { name: /File/ }).first()).toBeVisible({ timeout: 10000 });
}

/**
 * Selector for "My Trees" button in header.
 * Uses partial match because title includes additional text.
 */
export const myTreesButtonSelector = 'header button[title*="My Trees"]';

/**
 * Click the "My Trees" button to navigate to user's tree list.
 */
export async function clickMyTreesButton(page: any) {
  await page.locator(myTreesButtonSelector).click();
}
