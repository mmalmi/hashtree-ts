/**
 * WebRTC Connectivity E2E Test
 *
 * Tests that WebRTC connections work and are reflected in the UI:
 * - Connectivity indicator changes color when peers connect
 * - Peers are shown on settings page
 */
import { test, expect, type Page } from '@playwright/test';
import { disableOthersPool, setupPageErrorHandler } from './test-utils';

test.describe('WebRTC Connectivity', () => {
  test.setTimeout(90000);

  /**
   * Get pubkey from page
   */
  async function getPubkey(page: Page): Promise<string> {
    return page.evaluate(() => {
      const store = (window as any).__nostrStore;
      if (!store) return '';
      let pubkey = '';
      store.subscribe((s: { pubkey?: string }) => { pubkey = s?.pubkey || ''; })();
      return pubkey;
    });
  }

  /**
   * Follow a pubkey
   */
  async function followUser(page: Page, targetPubkey: string): Promise<void> {
    await page.evaluate(async (pk) => {
      const { followPubkey } = (window as any).__testHelpers || {};
      if (followPubkey) await followPubkey(pk);
    }, targetPubkey);
  }

  /**
   * Wait for connected peer count
   */
  async function waitForPeers(page: Page, count: number, timeout = 30000): Promise<void> {
    await page.waitForFunction(
      (expected) => {
        const store = (window as any).webrtcStore;
        return (store?.getConnectedCount?.() ?? 0) >= expected;
      },
      count,
      { timeout }
    );
  }

  test('connectivity indicator shows green when peers connect', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();
    setupPageErrorHandler(page1);
    setupPageErrorHandler(page2);

    try {
      await Promise.all([
        page1.goto('http://localhost:5173/'),
        page2.goto('http://localhost:5173/'),
      ]);

      await Promise.all([
        page1.waitForFunction(() => (window as any).__testHelpers?.followPubkey, { timeout: 15000 }),
        page2.waitForFunction(() => (window as any).__testHelpers?.followPubkey, { timeout: 15000 }),
      ]);

      await Promise.all([
        disableOthersPool(page1),
        disableOthersPool(page2),
      ]);

      const [pubkey1, pubkey2] = await Promise.all([getPubkey(page1), getPubkey(page2)]);

      // Mutual follows
      await Promise.all([
        followUser(page1, pubkey2),
        followUser(page2, pubkey1),
      ]);

      // Trigger hello broadcast
      await Promise.all([
        page1.evaluate(() => (window as any).webrtcStore?.sendHello?.()),
        page2.evaluate(() => (window as any).webrtcStore?.sendHello?.()),
      ]);

      // Wait for connection
      await waitForPeers(page1, 1, 45000);

      // Check indicator turns green/blue
      const indicator = page1.getByTestId('peer-indicator-dot');
      await expect(indicator).toBeVisible({ timeout: 5000 });

      await page1.waitForFunction(() => {
        const el = document.querySelector('[data-testid="peer-indicator-dot"]');
        if (!el) return false;
        const color = getComputedStyle(el).color;
        return color === 'rgb(63, 185, 80)' || color === 'rgb(88, 166, 255)';
      }, { timeout: 10000 });

      const color = await indicator.evaluate(el => getComputedStyle(el).color);
      expect(color === 'rgb(63, 185, 80)' || color === 'rgb(88, 166, 255)').toBe(true);
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });

  test('peers are shown on settings page', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();
    setupPageErrorHandler(page1);
    setupPageErrorHandler(page2);

    try {
      await Promise.all([
        page1.goto('http://localhost:5173/'),
        page2.goto('http://localhost:5173/'),
      ]);

      await Promise.all([
        page1.waitForFunction(() => (window as any).__testHelpers?.followPubkey, { timeout: 15000 }),
        page2.waitForFunction(() => (window as any).__testHelpers?.followPubkey, { timeout: 15000 }),
      ]);

      await Promise.all([
        disableOthersPool(page1),
        disableOthersPool(page2),
      ]);

      const [pubkey1, pubkey2] = await Promise.all([getPubkey(page1), getPubkey(page2)]);

      await Promise.all([
        followUser(page1, pubkey2),
        followUser(page2, pubkey1),
      ]);

      await Promise.all([
        page1.evaluate(() => (window as any).webrtcStore?.sendHello?.()),
        page2.evaluate(() => (window as any).webrtcStore?.sendHello?.()),
      ]);

      await waitForPeers(page1, 1, 45000);

      // Navigate to settings
      await page1.goto('http://localhost:5173/#/settings');
      await expect(page1.locator('text=Settings')).toBeVisible({ timeout: 5000 });

      // Verify peers count > 0
      await expect(page1.locator('text=/Peers \\(\\d+\\)/')).toBeVisible({ timeout: 10000 });
      const text = await page1.locator('text=/Peers \\(\\d+\\)/').textContent();
      const match = text?.match(/Peers \((\d+)\)/);
      expect(match).toBeTruthy();
      expect(parseInt(match![1], 10)).toBeGreaterThan(0);
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });
});
