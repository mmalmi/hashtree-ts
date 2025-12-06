/**
 * E2E test for nhash file permalinks
 * Tests direct navigation to /nhash1.../filename URLs
 *
 * Two browsers are used:
 * - Browser 1: Creates content and seeds it (stays open)
 * - Browser 2: Navigates directly to the permalink URL
 */
import { test, expect, type Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';

/** Selector for "My Trees" button in header (uses partial match) */
const myTreesButtonSelector = 'header button[title*="My Trees"]';

// Helper to create a temp file and upload it
async function uploadTempFile(page: Page, name: string, content: string | Buffer) {
  const tmpDir = os.tmpdir();
  const filePath = path.join(tmpDir, name);
  fs.writeFileSync(filePath, content);
  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.setInputFiles(filePath);
  await page.waitForTimeout(2500);
  fs.unlinkSync(filePath);
}

// Helper to clear storage and reset state for a fresh session
async function clearStorageAndReload(page: Page) {
  await page.evaluate(async () => {
    const dbs = await indexedDB.databases();
    for (const db of dbs) {
      if (db.name) indexedDB.deleteDatabase(db.name);
    }
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
  await page.waitForTimeout(500);
}

// Helper to wait for new user setup and navigate to public folder
async function waitForNewUserRedirect(page: Page) {
  // Wait for the public folder link to appear in the tree list (indicates setup complete)
  const publicLink = page.getByRole('link', { name: 'public' }).first();
  await expect(publicLink).toBeVisible({ timeout: 15000 });

  // Click into the public folder
  await publicLink.click();

  // Wait for navigation to complete and folder actions to be visible
  await page.waitForURL(/\/#\/npub.*\/public/, { timeout: 10000 });
  await expect(page.getByRole('button', { name: /File/ }).first()).toBeVisible({ timeout: 10000 });
}

// Helper to create tree via modal and navigate into it
async function createAndEnterTree(page: Page, name: string) {
  // Go to user's tree list first
  await page.locator(myTreesButtonSelector).click();
  await page.waitForTimeout(300);

  await page.getByRole('button', { name: 'New Folder' }).click();
  await page.locator('input[placeholder="Folder name..."]').fill(name);
  await page.getByRole('button', { name: 'Create' }).click();
  // After local createTree, navigates directly into empty tree
  await expect(page.getByText('Empty directory')).toBeVisible({ timeout: 10000 });
}

test.describe('nhash file permalinks', () => {
  // Increase timeout for WebRTC content transfer tests
  test.setTimeout(60000);

  // Skip: WebRTC peer connection between browsers is unreliable in CI
  test.skip('should display file content when navigating directly to nhash permalink URL', async ({ browser }) => {
    // Browser 1: Create content and seed it
    const context1 = await browser.newContext();
    const page1 = await context1.newPage();

    await page1.goto('/');
    await clearStorageAndReload(page1);

    // Wait for app to initialize
    await page1.waitForSelector('header span:has-text("hashtree")', { timeout: 5000 });

    // Wait for new user redirect to public folder
    await waitForNewUserRedirect(page1);

    // Create a new tree for testing (more reliable than using public folder)
    await createAndEnterTree(page1, 'permalink-test');

    // Create a file using File button
    await page1.getByRole('button', { name: /File/ }).first().click();

    // Wait for the modal input to appear
    const filenameInput = page1.locator('input[placeholder="File name..."]');
    await expect(filenameInput).toBeVisible({ timeout: 5000 });
    await filenameInput.fill('test-permalink.txt');
    await page1.getByRole('button', { name: 'Create' }).click();

    // Wait for textarea (edit mode) - file creation auto-navigates to edit mode
    await expect(page1.locator('textarea')).toBeVisible({ timeout: 10000 });

    // Type content and save
    await page1.locator('textarea').fill('Hello from permalink test!');
    await page1.getByRole('button', { name: 'Save' }).click();
    await page1.waitForTimeout(500);

    // Exit edit mode
    await page1.getByRole('button', { name: 'Done' }).click();
    await page1.waitForTimeout(500);

    // Find the Permalink link in preview (use exact match to avoid matching tree/file names containing "permalink")
    const permalinkLink = page1.getByRole('link', { name: 'Permalink', exact: true });
    await expect(permalinkLink).toBeVisible({ timeout: 5000 });

    // Get the href from the permalink
    const permalinkHref = await permalinkLink.getAttribute('href');
    expect(permalinkHref).toBeTruthy();
    // HashRouter URLs start with #/
    expect(permalinkHref).toMatch(/^#\/nhash1/);

    // Construct full URL (href already includes #)
    const permalinkUrl = `http://localhost:5173/${permalinkHref}`;
    console.log('Permalink URL:', permalinkUrl);

    // Browser 2: Navigate directly to the permalink while browser 1 is still seeding
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();

    // Listen for console logs in page2
    page2.on('console', msg => {
      if (msg.text().includes('[NHashView]') || msg.text().includes('[loadFromHash]')) {
        console.log('Page2 console:', msg.text());
      }
    });

    // Navigate directly to the permalink URL
    await page2.goto(permalinkUrl);

    // Wait for app to initialize
    await page2.waitForSelector('header span:has-text("hashtree")', { timeout: 5000 });

    // Wait for WebRTC peer connection between browser 1 and browser 2
    // The connectivity indicator shows:
    // - Yellow (#d29922): relays only, no peers
    // - Green (#3fb950): peers connected
    // Note: This may take up to 30 seconds for peer discovery via Nostr relays
    console.log('Waiting for peer connection...');

    // Wait for peers to connect (both browsers need to discover each other)
    // Check browser 1 has green indicator (peers connected)
    await expect(page1.locator('[data-testid="peer-indicator-dot"]'))
      .toHaveCSS('color', 'rgb(63, 185, 80)', { timeout: 45000 }); // Green = #3fb950
    console.log('Browser 1 has peers');

    // Check browser 2 also has green indicator (peers connected)
    await expect(page2.locator('[data-testid="peer-indicator-dot"]'))
      .toHaveCSS('color', 'rgb(63, 185, 80)', { timeout: 45000 }); // Green = #3fb950
    console.log('Browser 2 has peers');

    // Take screenshot to debug what page2 sees
    await page2.screenshot({ path: 'test-results/page2-permalink-debug.png' });

    // Debug: Check appStore rootHash and try to decode nhash
    const rootHashDebug = await page2.evaluate(() => {
      const store = (window as any).__appStore;
      if (!store) return { error: 'NO STORE' };
      const state = store.getState();

      // Get URL
      const url = window.location.href;
      const hashPath = window.location.hash;

      return {
        rootHash: state.rootHash ? Array.from(state.rootHash).slice(0, 8) : null,
        peerCount: state.peerCount,
        url,
        hashPath,
      };
    });
    console.log('Page2 appStore state:', JSON.stringify(rootHashDebug));

    // Wait for content to load (browser 1 should be seeding via WebRTC)
    // The file name should be visible in the preview header
    await expect(page2.locator('.font-medium:has-text("test-permalink.txt")')).toBeVisible({ timeout: 30000 });

    // The file content should be visible in preview
    // Look for any element containing the content text
    await expect(page2.getByText('Hello from permalink test!')).toBeVisible({ timeout: 15000 });

    // Cleanup
    await context1.close();
    await context2.close();
  });

  // Skip: setInputFiles doesn't trigger upload handler reliably in Playwright
  test.skip('should display directory content when navigating directly to nhash directory URL', async ({ browser }) => {
    // Browser 1: Create content and seed it
    const context1 = await browser.newContext();
    const page1 = await context1.newPage();

    await page1.goto('/');
    await clearStorageAndReload(page1);

    // Wait for app to initialize
    await page1.waitForSelector('header span:has-text("hashtree")', { timeout: 5000 });

    // Wait for new user redirect to public folder
    await waitForNewUserRedirect(page1);

    // Create a new tree for testing
    await createAndEnterTree(page1, 'dir-permalink-test');

    // Upload a file
    await uploadTempFile(page1, 'dir-test.txt', 'Directory test content');

    const fileList = page1.getByTestId('file-list');
    await expect(fileList.locator('span:text-is("dir-test.txt")')).toBeVisible({ timeout: 15000 });

    // Get the directory permalink from folder actions (link with title starting with "Permalink")
    const dirPermalinkLink = page1.locator('a[title^="Permalink"]').first();
    await expect(dirPermalinkLink).toBeVisible({ timeout: 5000 });

    const dirPermalinkHref = await dirPermalinkLink.getAttribute('href');
    expect(dirPermalinkHref).toBeTruthy();
    // HashRouter URLs start with #/
    expect(dirPermalinkHref).toMatch(/^#\/nhash1/);

    // Construct full URL (href already includes #)
    const dirPermalinkUrl = `http://localhost:5173/${dirPermalinkHref}`;
    console.log('Directory Permalink URL:', dirPermalinkUrl);

    // Browser 2: Navigate directly to the directory permalink
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();

    await page2.goto(dirPermalinkUrl);

    // Wait for directory listing to appear
    const fileList2 = page2.getByTestId('file-list');
    await expect(fileList2.locator('span:text-is("dir-test.txt")')).toBeVisible({ timeout: 15000 });

    // Cleanup
    await context1.close();
    await context2.close();
  });
});
