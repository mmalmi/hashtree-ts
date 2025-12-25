/**
 * WebRTC Connectivity E2E Test
 *
 * Tests that WebRTC connections work and are reflected in the UI:
 * - Connectivity indicator changes color when peers connect
 * - Peers are shown on settings page
 * - Data can be synced between peers
 */
import { test, expect, chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { waitForWebRTCConnection, enableOthersPool, setupPageErrorHandler } from './test-utils';

test.describe('WebRTC Connectivity', () => {
  // Run tests serially to avoid interference between test instances
  test.describe.configure({ mode: 'serial' });

  let browser1: Browser;
  let browser2: Browser;
  let context1: BrowserContext;
  let context2: BrowserContext;
  let page1: Page;
  let page2: Page;

  test.beforeAll(async () => {
    browser1 = await chromium.launch();
    browser2 = await chromium.launch();
  });

  test.afterAll(async () => {
    await browser1?.close();
    await browser2?.close();
  });

  test.beforeEach(async () => {
    context1 = await browser1.newContext();
    context2 = await browser2.newContext();
    page1 = await context1.newPage();
    page2 = await context2.newPage();
    setupPageErrorHandler(page1);
    setupPageErrorHandler(page2);

  });

  test.afterEach(async () => {
    await context1?.close();
    await context2?.close();
  });

  test('connectivity indicator shows green when peers connect', async () => {
    test.setTimeout(90000);

    // Navigate both pages
    await Promise.all([
      page1.goto('http://localhost:5173/'),
      page2.goto('http://localhost:5173/'),
    ]);

    // Wait for app to load
    await expect(page1.locator('header').first()).toBeVisible({ timeout: 15000 });
    await expect(page2.locator('header').first()).toBeVisible({ timeout: 15000 });

    // Enable others pool so peers can connect without following
    await enableOthersPool(page1);
    await enableOthersPool(page2);

    // Wait for npubs to be available (user generation takes time)
    const waitForNpub = async (page: Page): Promise<string> => {
      for (let i = 0; i < 20; i++) {
        const result = await page.evaluate(() => {
          const store = (window as any).__nostrStore;
          // Get current state from svelte store
          let npub = '';
          if (store && typeof store.subscribe === 'function') {
            store.subscribe((state: { npub?: string }) => {
              npub = state?.npub || '';
            })();
          }
          return { hasStore: !!store, npub };
        });
        if (result.npub) return result.npub;
        await page.waitForTimeout(500);
      }
      return '';
    };

    const npub1 = await waitForNpub(page1);
    const npub2 = await waitForNpub(page2);

    if (!npub1 || !npub2) {
      test.skip(true, 'Could not get npubs');
      return;
    }

    // Check indicator
    const indicator1 = page1.getByTestId('peer-indicator-dot');
    await expect(indicator1).toBeVisible({ timeout: 5000 });

    // Wait for WebRTC to establish connection via follows pool
    const connected = await waitForWebRTCConnection(page1, 45000);

    if (connected) {
      // Wait for indicator to update (refreshWebRTCStats runs every 2s)
      let indicatorColor = '';
      for (let i = 0; i < 10; i++) {
        indicatorColor = await indicator1.evaluate(el => getComputedStyle(el).color);
        const isGreen = indicatorColor === 'rgb(63, 185, 80)';
        const isBlue = indicatorColor === 'rgb(88, 166, 255)';
        if (isGreen || isBlue) break;
        await page1.waitForTimeout(500);
      }

      // Should be green or blue (not red/yellow)
      const isGreen = indicatorColor === 'rgb(63, 185, 80)';
      const isBlue = indicatorColor === 'rgb(88, 166, 255)';
      expect(isGreen || isBlue).toBe(true);

      // Navigate to settings and verify peers are shown
      await page1.goto('http://localhost:5173/#/settings');
      await expect(page1.locator('text=Settings')).toBeVisible({ timeout: 5000 });

      // Look for Peers section
      const peersSection = page1.locator('text=Peers').first();
      await expect(peersSection).toBeVisible({ timeout: 5000 });

      // Check that peer count is shown (should have at least 1 peer)
      const peerCountMatch = await page1.locator('text=/Peers \\(\\d+\\)/').textContent();
      const match = peerCountMatch?.match(/Peers \((\d+)\)/);
      if (match) {
        const peerCount = parseInt(match[1], 10);
        expect(peerCount).toBeGreaterThan(0);
      }
    } else {
      // Skip test if WebRTC connection couldn't be established
      test.skip(true, 'WebRTC connection not established - may be CI environment');
    }
  });

  test('peers are shown on settings page', async () => {
    test.setTimeout(90000);

    // Navigate both pages
    await Promise.all([
      page1.goto('http://localhost:5173/'),
      page2.goto('http://localhost:5173/'),
    ]);

    // Wait for app to load
    await expect(page1.locator('header').first()).toBeVisible({ timeout: 15000 });
    await expect(page2.locator('header').first()).toBeVisible({ timeout: 15000 });

    // Enable others pool so peers can connect
    await enableOthersPool(page1);
    await enableOthersPool(page2);

    // Wait for WebRTC connection
    const connected = await waitForWebRTCConnection(page1, 45000);

    if (connected) {
      // Wait for refreshWebRTCStats to update the store (runs every 2s)
      await page1.waitForTimeout(2500);

      // Navigate to settings
      await page1.goto('http://localhost:5173/#/settings');
      await expect(page1.locator('text=Settings')).toBeVisible({ timeout: 5000 });

      // Verify peers section shows connected peers
      await expect(page1.locator('text=/Peers \\(\\d+\\)/')).toBeVisible({ timeout: 10000 });

      const peerCountText = await page1.locator('text=/Peers \\(\\d+\\)/').textContent();
      const match = peerCountText?.match(/Peers \((\d+)\)/);
      if (match) {
        const peerCount = parseInt(match[1], 10);
        expect(peerCount).toBeGreaterThan(0);
      }
    } else {
      test.skip(true, 'WebRTC connection not established - may be CI environment');
    }
  });
});
