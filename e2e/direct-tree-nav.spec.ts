/**
 * E2E test for direct navigation to tree URLs
 *
 * Tests that navigating directly to a tree URL (cold start) loads the content
 * without needing to go to home page first.
 */
import { test, expect } from '@playwright/test';
import { setupPageErrorHandler, navigateToPublicFolder, disableOthersPool, useLocalRelay } from './test-utils.js';

test.describe('Direct Tree Navigation', () => {
  test('can create file and direct navigate to it in new context', { timeout: 90000 }, async ({ browser }) => {
    test.slow();

    // === Phase 1: Create a file in first context ===
    const context1 = await browser.newContext();
    const page1 = await context1.newPage();
    setupPageErrorHandler(page1);

    await page1.goto('/');
    await disableOthersPool(page1);
    await useLocalRelay(page1);

    // Navigate to public folder and create a test file
    await navigateToPublicFolder(page1);

    // Create a folder with a file
    await page1.getByRole('button', { name: 'New Folder' }).click();
    const folderInput = page1.locator('input[placeholder="Folder name..."]');
    await folderInput.waitFor({ timeout: 5000 });
    await folderInput.fill('direct-nav-test');
    await page1.click('button:has-text("Create")');
    await expect(page1.locator('.fixed.inset-0.bg-black')).not.toBeVisible({ timeout: 10000 });

    // Navigate into the folder
    const folderLink = page1.locator('[data-testid="file-list"] a').filter({ hasText: 'direct-nav-test' }).first();
    await expect(folderLink).toBeVisible({ timeout: 15000 });
    await folderLink.click();
    await page1.waitForURL(/direct-nav-test/, { timeout: 10000 });

    // Create a file via tree API
    await page1.evaluate(async () => {
      const { getTree, LinkType } = await import('/src/store.ts');
      const { autosaveIfOwn } = await import('/src/nostr.ts');
      const { getCurrentRootCid } = await import('/src/actions/route.ts');
      const { getRouteSync } = await import('/src/stores/index.ts');
      const route = getRouteSync();

      const tree = getTree();
      let rootCid = getCurrentRootCid();
      if (!rootCid) return;

      const content = new TextEncoder().encode('Hello from direct nav test!');
      const { cid, size } = await tree.putFile(content);
      rootCid = await tree.setEntry(rootCid, route.path, 'test.txt', cid, size, LinkType.Blob);
      autosaveIfOwn(rootCid);
    });

    // Wait for file to appear
    await expect(page1.locator('[data-testid="file-list"] a').filter({ hasText: 'test.txt' })).toBeVisible({ timeout: 15000 });

    // Get the current URL for direct navigation
    const fileUrl = page1.url().replace(/\/$/, '') + '/test.txt';
    console.log('[test] File URL:', fileUrl);

    // Wait for nostr event to publish (throttle delay)
    await page1.waitForTimeout(2000);

    // Get npub for second context
    const npub = await page1.evaluate(() => {
      const match = window.location.hash.match(/npub1[a-z0-9]+/);
      return match ? match[0] : null;
    });
    console.log('[test] User npub:', npub?.slice(0, 20));

    // Close first context
    await context1.close();

    // === Phase 2: Direct navigate in fresh context ===
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    setupPageErrorHandler(page2);

    // Enable console logging for debugging
    page2.on('console', msg => {
      const text = msg.text();
      if (text.includes('[refResolver]') || text.includes('NDK') || text.includes('error')) {
        console.log(`[page2] ${text}`);
      }
    });

    // Direct navigate to the file URL (cold start)
    console.log('[test] Direct navigating to:', fileUrl);
    await page2.goto(fileUrl);

    // Disable others pool after goto
    await disableOthersPool(page2);
    await useLocalRelay(page2);

    // Wait for content to load - should show file viewer with content
    // The file content "Hello from direct nav test!" should be visible
    const content = page2.locator('pre').filter({ hasText: 'Hello from direct nav test!' });
    await expect(content).toBeVisible({ timeout: 30000 });

    console.log('[test] SUCCESS: Direct navigation loaded file content');

    await context2.close();
  });

  test('direct navigate to tree root shows directory listing', { timeout: 60000 }, async ({ browser }) => {
    test.slow();

    // === Phase 1: Create a folder with files ===
    const context1 = await browser.newContext();
    const page1 = await context1.newPage();
    setupPageErrorHandler(page1);

    await page1.goto('/');
    await disableOthersPool(page1);
    await useLocalRelay(page1);

    await navigateToPublicFolder(page1);

    // Create test folder
    await page1.getByRole('button', { name: 'New Folder' }).click();
    const folderInput = page1.locator('input[placeholder="Folder name..."]');
    await folderInput.waitFor({ timeout: 5000 });
    await folderInput.fill('dir-nav-test');
    await page1.click('button:has-text("Create")');
    await expect(page1.locator('.fixed.inset-0.bg-black')).not.toBeVisible({ timeout: 10000 });

    // Navigate into folder
    const folderLink = page1.locator('[data-testid="file-list"] a').filter({ hasText: 'dir-nav-test' }).first();
    await expect(folderLink).toBeVisible({ timeout: 15000 });
    await folderLink.click();
    await page1.waitForURL(/dir-nav-test/, { timeout: 10000 });

    // Create multiple files
    await page1.evaluate(async () => {
      const { getTree, LinkType } = await import('/src/store.ts');
      const { autosaveIfOwn } = await import('/src/nostr.ts');
      const { getCurrentRootCid } = await import('/src/actions/route.ts');
      const { getRouteSync } = await import('/src/stores/index.ts');
      const route = getRouteSync();

      const tree = getTree();
      let rootCid = getCurrentRootCid();
      if (!rootCid) return;

      // Add file1.txt
      const content1 = new TextEncoder().encode('File 1 content');
      const { cid: cid1, size: size1 } = await tree.putFile(content1);
      rootCid = await tree.setEntry(rootCid, route.path, 'file1.txt', cid1, size1, LinkType.Blob);

      // Add file2.txt
      const content2 = new TextEncoder().encode('File 2 content');
      const { cid: cid2, size: size2 } = await tree.putFile(content2);
      rootCid = await tree.setEntry(rootCid, route.path, 'file2.txt', cid2, size2, LinkType.Blob);

      autosaveIfOwn(rootCid);
    });

    // Wait for files to appear
    await expect(page1.locator('[data-testid="file-list"] a').filter({ hasText: 'file1.txt' })).toBeVisible({ timeout: 15000 });
    await expect(page1.locator('[data-testid="file-list"] a').filter({ hasText: 'file2.txt' })).toBeVisible({ timeout: 15000 });

    // Get directory URL
    const dirUrl = page1.url();
    console.log('[test] Directory URL:', dirUrl);

    // Wait for nostr publish
    await page1.waitForTimeout(2000);

    await context1.close();

    // === Phase 2: Direct navigate to directory ===
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    setupPageErrorHandler(page2);

    console.log('[test] Direct navigating to directory:', dirUrl);
    await page2.goto(dirUrl);
    await disableOthersPool(page2);
    await useLocalRelay(page2);

    // Should show directory listing with both files
    await expect(page2.locator('[data-testid="file-list"] a').filter({ hasText: 'file1.txt' })).toBeVisible({ timeout: 30000 });
    await expect(page2.locator('[data-testid="file-list"] a').filter({ hasText: 'file2.txt' })).toBeVisible({ timeout: 30000 });

    console.log('[test] SUCCESS: Direct navigation showed directory listing');

    await context2.close();
  });
});
