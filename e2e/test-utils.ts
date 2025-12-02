/**
 * Shared test utilities for e2e tests
 */

import { expect } from '@playwright/test';

/**
 * Filter out rate-limit errors from relay.
 * Some relays rate-limit nostr events, but temp.iris.to does not.
 * These errors are irrelevant to the tests.
 */
export function setupPageErrorHandler(page: any) {
  page.on('pageerror', (err: Error) => {
    if (!err.message.includes('rate-limited')) {
      console.log('Page error:', err.message);
    }
  });
}

/**
 * Wait for new user redirect to complete.
 * New users get redirected to /{npub}/home automatically.
 */
export async function waitForNewUserRedirect(page: any) {
  await page.waitForURL(/\/#\/npub.*\/home/, { timeout: 10000 });
  await expect(page.getByRole('button', { name: /File/ }).first()).toBeVisible({ timeout: 10000 });
}
