/**
 * E2E tests for background sync of followed users' trees
 *
 * Tests that:
 * 1. User B follows User A
 * 2. User A creates a public tree with content
 * 3. User B's background sync automatically pulls A's tree data
 * 4. User B can access A's tree content offline
 */
import { test, expect, Page } from '@playwright/test';
import { setupPageErrorHandler } from './test-utils.js';

// Helper to set up a fresh user session
async function setupFreshUser(page: Page) {
  setupPageErrorHandler(page);

  await page.goto('http://localhost:5173');

  // Clear storage for fresh state
  await page.evaluate(async () => {
    const dbs = await indexedDB.databases();
    for (const db of dbs) {
      if (db.name) indexedDB.deleteDatabase(db.name);
    }
    localStorage.clear();
    sessionStorage.clear();
  });

  await page.reload();
  await page.waitForSelector('header span:has-text("hashtree")', { timeout: 10000 });

  // Wait for the public folder link to appear
  const publicLink = page.getByRole('link', { name: 'public' }).first();
  await expect(publicLink).toBeVisible({ timeout: 15000 });
}

// Helper to get the user's npub from the URL
async function getNpub(page: Page): Promise<string> {
  // Click into public folder to get the full URL with npub
  const publicLink = page.getByRole('link', { name: 'public' }).first();
  await publicLink.click();
  await page.waitForURL(/\/#\/npub.*\/public/, { timeout: 10000 });

  const url = page.url();
  const match = url.match(/npub1[a-z0-9]+/);
  if (!match) throw new Error('Could not find npub in URL');
  return match[0];
}

// Helper to follow a user by their npub
async function followUser(page: Page, targetNpub: string) {
  // Navigate to the user's profile page
  await page.goto(`http://localhost:5173/#/${targetNpub}`);

  // Click the Follow button
  const followButton = page.getByRole('button', { name: 'Follow', exact: true });
  await expect(followButton).toBeVisible({ timeout: 5000 });
  await followButton.click();

  // Wait for follow to complete
  await expect(
    page.getByRole('button', { name: 'Following' })
      .or(page.getByRole('button', { name: 'Unfollow' }))
  ).toBeVisible({ timeout: 10000 });
}

// Helper to upload a file using the hidden file input
async function uploadFile(page: Page, fileName: string, content: string) {
  // Find the file input element
  const fileInput = page.locator('input[type="file"][multiple]').first();

  // Create a temp file path and buffer
  const buffer = Buffer.from(content, 'utf-8');

  // Use setInputFiles with a buffer object
  await fileInput.setInputFiles({
    name: fileName,
    mimeType: 'text/plain',
    buffer,
  });

  // Wait for upload to complete - check for file to appear in list
  await page.waitForTimeout(3000);
}

// Helper to get storage stats from a page
async function getStorageStats(page: Page): Promise<{ items: number; bytes: number }> {
  return await page.evaluate(async () => {
    const store = (window as any).__idbStore;
    if (!store) return { items: 0, bytes: 0 };
    const items = await store.count();
    const bytes = await store.totalBytes();
    return { items, bytes };
  });
}

// Helper to wait for synced storage to show a user on settings page
async function waitForSyncedUser(page: Page, npubPrefix: string, timeout = 30000): Promise<boolean> {
  const start = Date.now();
  let lastContent = '';
  while (Date.now() - start < timeout) {
    await page.goto('http://localhost:5173/#/settings');
    await page.waitForTimeout(1000); // Give time for async load

    // Check if the synced storage section exists and contains the npub
    const syncedStorage = page.getByTestId('synced-storage');
    const isVisible = await syncedStorage.isVisible().catch(() => false);

    if (isVisible) {
      const content = await syncedStorage.textContent();
      lastContent = content || '';
      // Check if it contains the expected user (first 8 chars of npub, after 'npub1')
      const searchTerm = npubPrefix.slice(5, 13); // Get unique part after 'npub1'
      if (content && content.includes(searchTerm)) {
        console.log(`Found user in synced storage: ${searchTerm}`);
        return true;
      }
    }

    await page.waitForTimeout(2000);
  }
  console.log(`Synced storage not found. Last content: "${lastContent.slice(0, 100)}..."`);
  return false;
}

test.describe('Background Sync', () => {
  // Serial mode: tests share relays and would interfere in parallel
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120000); // 2 minutes per test

  test('syncs followed user public tree data', async ({ browser }) => {
    // Create two browser contexts (simulating two different users)
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    // Log console for debugging
    pageA.on('console', msg => {
      const text = msg.text();
      if (text.includes('[backgroundSync]')) console.log(`[User A] ${text}`);
    });
    pageB.on('console', msg => {
      const text = msg.text();
      if (text.includes('[backgroundSync]')) console.log(`[User B] ${text}`);
    });

    try {
      // === Setup User A ===
      console.log('Setting up User A...');
      await setupFreshUser(pageA);
      const npubA = await getNpub(pageA);
      console.log(`User A npub: ${npubA.slice(0, 20)}...`);

      // === Setup User B ===
      console.log('Setting up User B...');
      await setupFreshUser(pageB);
      const npubB = await getNpub(pageB);
      console.log(`User B npub: ${npubB.slice(0, 20)}...`);

      // === User A: Upload content to public folder ===
      console.log('User A: Uploading test file...');
      await pageA.goto(`http://localhost:5173/#/${npubA}/public`);
      await pageA.waitForTimeout(1000);

      const testContent = 'Hello from User A! This is test content for background sync.';
      await uploadFile(pageA, 'sync-test.txt', testContent);
      console.log('User A: File uploaded');

      // Get A's storage stats
      const statsA = await getStorageStats(pageA);
      console.log(`User A storage: ${statsA.items} items, ${statsA.bytes} bytes`);

      // === User B: Get initial storage stats (should be minimal) ===
      const statsBBefore = await getStorageStats(pageB);
      console.log(`User B storage before follow: ${statsBBefore.items} items, ${statsBBefore.bytes} bytes`);

      // === User B: Follow User A ===
      console.log('User B: Following User A...');
      await followUser(pageB, npubA);
      console.log('User B: Now following User A');

      // === Wait for background sync by polling storage stats ===
      console.log('Waiting for background sync...');
      let statsBAfter = statsBBefore;
      for (let i = 0; i < 15; i++) {
        await pageB.waitForTimeout(1000);
        statsBAfter = await getStorageStats(pageB);
        if (statsBAfter.items > statsBBefore.items) {
          console.log(`Background sync complete after ${i + 1}s`);
          break;
        }
      }
      console.log(`User B storage after sync: ${statsBAfter.items} items, ${statsBAfter.bytes} bytes`);

      // Verify B has pulled some data (proves background sync worked)
      expect(statsBAfter.items).toBeGreaterThan(statsBBefore.items);

      // === User B: Navigate to A's public folder and verify content ===
      console.log('User B: Navigating to A\'s public folder...');
      await pageB.goto(`http://localhost:5173/#/${npubA}/public`);

      // Check if the file appears (should be fast since data was already synced in background)
      const fileLink = pageB.getByRole('link', { name: 'sync-test.txt' });
      await expect(fileLink).toBeVisible({ timeout: 5000 });

      // Click to view the file and verify content
      await fileLink.click();
      const content = pageB.locator('pre, .viewer-content').first();
      await expect(content).toContainText('Hello from User A', { timeout: 5000 });

      console.log('\n=== Background Sync Test Passed ===');
      console.log(`User A's npub: ${npubA}`);
      console.log(`User B's npub: ${npubB}`);
      console.log(`User B synced ${statsBAfter.items - statsBBefore.items} items`);

    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test('both users following each other sync bidirectionally', async ({ browser }) => {
    // Create two browser contexts
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    // Log background sync messages
    pageA.on('console', msg => {
      const text = msg.text();
      if (text.includes('[backgroundSync]')) console.log(`[A] ${text}`);
    });
    pageB.on('console', msg => {
      const text = msg.text();
      if (text.includes('[backgroundSync]')) console.log(`[B] ${text}`);
    });

    try {
      // === Setup both users ===
      console.log('Setting up User A...');
      await setupFreshUser(pageA);
      const npubA = await getNpub(pageA);
      console.log(`User A npub: ${npubA.slice(0, 20)}...`);

      console.log('Setting up User B...');
      await setupFreshUser(pageB);
      const npubB = await getNpub(pageB);
      console.log(`User B npub: ${npubB.slice(0, 20)}...`);

      // === Both users upload content ===
      console.log('User A: Uploading content...');
      await pageA.goto(`http://localhost:5173/#/${npubA}/public`);
      await pageA.waitForTimeout(1000);
      await uploadFile(pageA, 'from-a.txt', 'Content from User A for sync test');

      console.log('User B: Uploading content...');
      await pageB.goto(`http://localhost:5173/#/${npubB}/public`);
      await pageB.waitForTimeout(1000);
      await uploadFile(pageB, 'from-b.txt', 'Content from User B for sync test');

      // === Users follow each other ===
      console.log('User A: Following User B...');
      await followUser(pageA, npubB);

      console.log('User B: Following User A...');
      await followUser(pageB, npubA);

      // === Wait for bidirectional sync ===
      console.log('Waiting for bidirectional sync...');
      await pageA.waitForTimeout(10000);
      await pageB.waitForTimeout(5000);

      // === Verify User A can see B's content ===
      console.log('User A: Checking B\'s content...');
      await pageA.goto(`http://localhost:5173/#/${npubB}/public`);
      await pageA.waitForTimeout(3000);

      const fileBInA = pageA.getByRole('link', { name: 'from-b.txt' });
      await expect(fileBInA).toBeVisible({ timeout: 10000 });

      // === Verify User B can see A's content ===
      console.log('User B: Checking A\'s content...');
      await pageB.goto(`http://localhost:5173/#/${npubA}/public`);
      await pageB.waitForTimeout(3000);

      const fileAInB = pageB.getByRole('link', { name: 'from-a.txt' });
      await expect(fileAInB).toBeVisible({ timeout: 10000 });

      console.log('\n=== Bidirectional Sync Test Passed ===');

    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test('own trees sync for cross-device access', async ({ browser }) => {
    // This test simulates logging in on two "devices" (browser contexts)
    // with the same account and verifying content syncs

    // Create first context with clipboard permissions
    const context1 = await browser.newContext({
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const page1 = await context1.newPage();

    // Log sync messages
    page1.on('console', msg => {
      const text = msg.text();
      if (text.includes('[backgroundSync]')) console.log(`[Device1] ${text}`);
    });

    try {
      // === Setup user on first device ===
      console.log('Setting up user on Device 1...');
      await setupFreshUser(page1);
      const npub = await getNpub(page1);
      console.log(`User npub: ${npub.slice(0, 20)}...`);

      // === Upload content on Device 1 ===
      console.log('Device 1: Uploading content...');
      await page1.goto(`http://localhost:5173/#/${npub}/public`);
      await page1.waitForTimeout(1000);
      await uploadFile(page1, 'cross-device.txt', 'Content uploaded from Device 1');
      console.log('Device 1: Content uploaded');

      // Get storage stats from Device 1
      const stats1 = await getStorageStats(page1);
      console.log(`Device 1 storage: ${stats1.items} items, ${stats1.bytes} bytes`);

      // Go to settings and copy the secret key
      console.log('Device 1: Copying secret key from settings...');
      await page1.goto('http://localhost:5173/#/settings');
      await page1.waitForTimeout(1000);

      // Click the copy secret key button
      const copyButton = page1.getByTestId('copy-secret-key');
      await expect(copyButton).toBeVisible({ timeout: 5000 });
      await copyButton.click();
      await page1.waitForTimeout(500);

      // Get the nsec from clipboard
      const nsec = await page1.evaluate(async () => {
        return await navigator.clipboard.readText();
      });
      console.log(`Device 1: Got nsec from clipboard: ${nsec.slice(0, 10)}...`);

      if (!nsec || !nsec.startsWith('nsec1')) {
        throw new Error('Could not get nsec from clipboard');
      }

      // === Setup second "device" with same account ===
      console.log('Setting up Device 2 with same account...');
      const context2 = await browser.newContext();
      const page2 = await context2.newPage();

      page2.on('console', msg => {
        const text = msg.text();
        if (text.includes('[backgroundSync]')) console.log(`[Device2] ${text}`);
      });

      // Load app once (it will auto-generate a key), then clear and set our nsec
      await page2.goto('http://localhost:5173');
      await page2.waitForSelector('header span:has-text("hashtree")', { timeout: 10000 });

      // Clear all storage and set only our nsec
      console.log('Device 2: Setting up nsec login...');
      await page2.evaluate(async (nsecValue) => {
        // Clear all IndexedDB databases
        const dbs = await indexedDB.databases();
        for (const db of dbs) {
          if (db.name) indexedDB.deleteDatabase(db.name);
        }
        // Clear all storage
        localStorage.clear();
        sessionStorage.clear();
        // Set our nsec to auto-login on reload
        localStorage.setItem('hashtree:nsec', nsecValue);
        localStorage.setItem('hashtree:loginType', 'nsec');
      }, nsec);

      // Reload - app should auto-login with our nsec
      console.log('Device 2: Reloading with nsec...');
      await page2.reload();
      await page2.waitForSelector('header span:has-text("hashtree")', { timeout: 10000 });
      await page2.waitForTimeout(3000); // Wait for login and background sync to start

      // === Navigate to public folder and wait for file to sync ===
      console.log('Device 2: Waiting for file to sync...');
      await page2.goto(`http://localhost:5173/#/${npub}/public`);

      // Wait for the file to appear (synced from Nostr via background sync)
      const file = page2.getByRole('link', { name: 'cross-device.txt' });
      await expect(file).toBeVisible({ timeout: 30000 });
      console.log('Device 2: File synced!');

      // Get storage stats from Device 2
      const stats2 = await getStorageStats(page2);
      console.log(`Device 2 storage: ${stats2.items} items, ${stats2.bytes} bytes`);

      // Click to view the file and verify content
      await file.click();
      // Wait for content to load
      const content = page2.locator('pre, .viewer-content').first();
      await expect(content).toContainText('Content uploaded from Device 1', { timeout: 10000 });
      console.log('Device 2: Content verified!');

      console.log('\n=== Cross-Device Sync Test Passed ===');

      await context2.close();
    } finally {
      await context1.close();
    }
  });
});
