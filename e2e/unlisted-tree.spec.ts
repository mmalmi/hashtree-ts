/**
 * E2E tests for unlisted (link-visible) trees
 *
 * Tests the three-tier visibility model:
 * - Creating unlisted trees with ?k= param in URL
 * - Uploading files to unlisted trees
 * - Accessing unlisted trees from a fresh browser with the link
 * - Verifying visibility icons in tree list and inside tree view
 */
import { test, expect } from '@playwright/test';
import { setupPageErrorHandler, waitForNewUserRedirect, myTreesButtonSelector } from './test-utils.js';

test.describe('Unlisted Tree Visibility', () => {
  test.beforeEach(async ({ page }) => {
    setupPageErrorHandler(page);

    // Go to page first to be able to clear storage
    await page.goto('/');

    // Clear IndexedDB and localStorage before each test
    await page.evaluate(async () => {
      const dbs = await indexedDB.databases();
      for (const db of dbs) {
        if (db.name) indexedDB.deleteDatabase(db.name);
      }
      localStorage.clear();
      sessionStorage.clear();
    });

    // Reload to get truly fresh state (after clearing storage)
    await page.reload();
    await page.waitForTimeout(500);

    // App auto-generates key on first visit, wait for header to appear
    await page.waitForSelector('header span:has-text("hashtree")', { timeout: 5000 });

    // New users get auto-redirected to their home folder - wait for that
    await waitForNewUserRedirect(page);
  });

  test('should create unlisted tree with ?k= param in URL', async ({ page }) => {
    // Go to user's tree list
    await page.locator(myTreesButtonSelector).click();
    await page.waitForTimeout(300);

    // Click New Folder button
    await page.getByRole('button', { name: 'New Folder' }).click();
    await page.waitForTimeout(200);

    // Fill tree name
    await page.locator('input[placeholder="Folder name..."]').fill('unlisted-test');

    // Select "unlisted" visibility
    await page.getByRole('button', { name: /unlisted/i }).click();
    await page.waitForTimeout(100);

    // Verify unlisted is selected (has accent styling)
    const unlistedBtn = page.locator('button:has-text("unlisted")');
    await expect(unlistedBtn).toHaveClass(/border-accent/);

    // Create the tree
    await page.getByRole('button', { name: 'Create' }).click();

    // Wait for navigation and URL to contain ?k= parameter
    await page.waitForTimeout(1000);
    const url = page.url();
    expect(url).toContain('unlisted-test');
    expect(url).toMatch(/\?k=[a-f0-9]+/i);

    // Should show Empty directory (we're inside the tree now)
    await expect(page.getByText('Empty directory')).toBeVisible({ timeout: 5000 });
  });

  test('should show link icon for unlisted tree in tree list', async ({ page }) => {
    // Go to user's tree list
    await page.locator(myTreesButtonSelector).click();
    await page.waitForTimeout(300);

    // Create an unlisted tree
    await page.getByRole('button', { name: 'New Folder' }).click();
    await page.locator('input[placeholder="Folder name..."]').fill('unlisted-icons');
    await page.getByRole('button', { name: /unlisted/i }).click();
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(1000);

    // Go back to tree list
    await page.locator(myTreesButtonSelector).click();
    await page.waitForTimeout(500);

    // Find the unlisted-icons tree row and check for link icon
    const treeRow = page.locator('a:has-text("unlisted-icons")');
    await expect(treeRow).toBeVisible({ timeout: 5000 });

    // Should have link icon (i-lucide-link) for unlisted visibility
    const linkIcon = treeRow.locator('span.i-lucide-link');
    await expect(linkIcon).toBeVisible();
  });

  test('should show link icon inside unlisted tree view', async ({ page }) => {
    // Go to user's tree list
    await page.locator(myTreesButtonSelector).click();
    await page.waitForTimeout(300);

    // Create an unlisted tree
    await page.getByRole('button', { name: 'New Folder' }).click();
    await page.locator('input[placeholder="Folder name..."]').fill('unlisted-inside');
    await page.getByRole('button', { name: /unlisted/i }).click();
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(1000);

    // Should be inside the tree now - check for link icon in the current directory row
    const currentDirRow = page.locator('a:has-text("unlisted-inside")').first();
    await expect(currentDirRow).toBeVisible({ timeout: 5000 });

    // Should have link icon for unlisted visibility inside tree view
    const linkIcon = currentDirRow.locator('span.i-lucide-link');
    await expect(linkIcon).toBeVisible();
  });

  test('should preserve ?k= param when navigating within unlisted tree', async ({ page }) => {
    // Go to user's tree list
    await page.locator(myTreesButtonSelector).click();
    await page.waitForTimeout(300);

    // Create an unlisted tree
    await page.getByRole('button', { name: 'New Folder' }).click();
    await page.locator('input[placeholder="Folder name..."]').fill('unlisted-nav');
    await page.getByRole('button', { name: /unlisted/i }).click();
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(1000);

    // Get initial URL with ?k= param
    const initialUrl = page.url();
    expect(initialUrl).toMatch(/\?k=[a-f0-9]+/i);
    const kParam = initialUrl.match(/\?k=([a-f0-9]+)/i)?.[1];
    expect(kParam).toBeTruthy();

    // Create a file inside
    await page.getByRole('button', { name: /File/ }).first().click();
    await page.locator('input[placeholder="File name..."]').fill('test.txt');
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(500);

    // URL should still have ?k= param after file creation
    expect(page.url()).toContain(`?k=${kParam}`);

    // Create a subfolder
    await page.getByRole('button', { name: /Folder/ }).first().click();
    await page.locator('input[placeholder="Folder name..."]').fill('subfolder');
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(500);

    // Click on subfolder to navigate into it
    await page.locator('a:has-text("subfolder")').click();
    await page.waitForTimeout(500);

    // URL should still have ?k= param
    expect(page.url()).toContain(`?k=${kParam}`);
    expect(page.url()).toContain('subfolder');

    // Go back to parent
    await page.locator('a:has-text("..")').click();
    await page.waitForTimeout(500);

    // URL should still have ?k= param
    expect(page.url()).toContain(`?k=${kParam}`);
  });

  test('should include ?k= param when clicking unlisted tree in tree list', async ({ page }) => {
    // Go to user's tree list
    await page.locator(myTreesButtonSelector).click();
    await page.waitForTimeout(300);

    // Create an unlisted tree
    await page.getByRole('button', { name: 'New Folder' }).click();
    await page.locator('input[placeholder="Folder name..."]').fill('unlisted-click');
    await page.getByRole('button', { name: /unlisted/i }).click();
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(1000);

    // Get the ?k= value from current URL
    const kParam = page.url().match(/\?k=([a-f0-9]+)/i)?.[1];
    expect(kParam).toBeTruthy();

    // Go back to tree list
    await page.locator(myTreesButtonSelector).click();
    await page.waitForTimeout(500);

    // Click on the unlisted tree
    await page.locator('a:has-text("unlisted-click")').click();
    await page.waitForTimeout(500);

    // URL should have ?k= param
    expect(page.url()).toContain(`?k=${kParam}`);
  });

  test('should create file in unlisted tree and read it back', async ({ page }) => {
    // Go to user's tree list
    await page.locator(myTreesButtonSelector).click();
    await page.waitForTimeout(300);

    // Create an unlisted tree
    await page.getByRole('button', { name: 'New Folder' }).click();
    await page.locator('input[placeholder="Folder name..."]').fill('unlisted-file');
    await page.getByRole('button', { name: /unlisted/i }).click();
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(1000);

    // Create a file with content
    await page.getByRole('button', { name: /File/ }).first().click();
    await page.locator('input[placeholder="File name..."]').fill('secret.txt');
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(500);

    // Should be in edit mode
    await expect(page.locator('textarea')).toBeVisible({ timeout: 5000 });

    // Type content
    await page.locator('textarea').fill('This is secret content!');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.waitForTimeout(500);

    // Exit edit mode
    await page.getByRole('button', { name: 'Done' }).click();
    await page.waitForTimeout(300);

    // Content should be visible in preview
    await expect(page.locator('pre')).toHaveText('This is secret content!');
  });

  test('should access unlisted tree from fresh browser with link', async ({ page, browser }) => {
    // Go to user's tree list
    await page.locator(myTreesButtonSelector).click();
    await page.waitForTimeout(300);

    // Create an unlisted tree
    await page.getByRole('button', { name: 'New Folder' }).click();
    await page.locator('input[placeholder="Folder name..."]').fill('unlisted-share');
    await page.getByRole('button', { name: /unlisted/i }).click();
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(1000);

    // Create a file with content
    await page.getByRole('button', { name: /File/ }).first().click();
    await page.locator('input[placeholder="File name..."]').fill('shared.txt');
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(500);

    // Type content and save
    await page.locator('textarea').fill('Shared secret content');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.waitForTimeout(1000);

    // Get the full URL with ?k= param
    const shareUrl = page.url();
    expect(shareUrl).toMatch(/\?k=[a-f0-9]+/i);

    // Extract npub, treeName, and k param
    const urlMatch = shareUrl.match(/#\/(npub[^/]+)\/([^/?]+)\?k=([a-f0-9]+)/i);
    expect(urlMatch).toBeTruthy();
    const [, npub, treeName, kParam] = urlMatch!;

    // Open fresh browser context (no cookies, no localStorage)
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    setupPageErrorHandler(page2);

    // Navigate to the tree using the full URL with ?k= param
    const treeUrl = `http://localhost:5173/#/${npub}/${treeName}?k=${kParam}`;
    await page2.goto(treeUrl);
    await page2.waitForTimeout(3000);

    // Should see the file in the tree
    await expect(page2.locator('span:text-is("shared.txt")')).toBeVisible({ timeout: 15000 });

    // Click on the file
    await page2.locator('a:has-text("shared.txt")').click();
    await page2.waitForTimeout(1000);

    // Should see the decrypted content
    await expect(page2.locator('pre')).toHaveText('Shared secret content', { timeout: 10000 });

    await context2.close();
  });

  test('should NOT access unlisted tree without ?k= param', async ({ page, browser }) => {
    // Go to user's tree list
    await page.locator(myTreesButtonSelector).click();
    await page.waitForTimeout(300);

    // Create an unlisted tree
    await page.getByRole('button', { name: 'New Folder' }).click();
    await page.locator('input[placeholder="Folder name..."]').fill('unlisted-noaccess');
    await page.getByRole('button', { name: /unlisted/i }).click();
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(1000);

    // Get URL and extract npub and treeName (but NOT the k param)
    const shareUrl = page.url();
    const urlMatch = shareUrl.match(/#\/(npub[^/]+)\/([^/?]+)/);
    expect(urlMatch).toBeTruthy();
    const [, npub, treeName] = urlMatch!;

    // Open fresh browser context
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    setupPageErrorHandler(page2);

    // Navigate to the tree WITHOUT ?k= param
    const treeUrlWithoutKey = `http://localhost:5173/#/${npub}/${treeName}`;
    await page2.goto(treeUrlWithoutKey);
    await page2.waitForTimeout(3000);

    // Should NOT be able to access the tree content
    // Either shows empty, error, or the tree is not decryptable
    // The tree should not show "Empty directory" (which means access granted)
    // It should show some indication that access is denied or tree can't be read
    const emptyDir = page2.getByText('Empty directory');
    const isAccessible = await emptyDir.isVisible().catch(() => false);

    // If the tree shows as accessible without the key, that's a security issue
    // For now, we expect it to either not load or show an error
    // This test documents the expected behavior
    expect(isAccessible).toBe(false);

    await context2.close();
  });

  test('should show correct visibility icons for different tree types', async ({ page }) => {
    // Go to user's tree list
    await page.locator(myTreesButtonSelector).click();
    await page.waitForTimeout(300);

    // Create a public tree
    await page.getByRole('button', { name: 'New Folder' }).click();
    await page.locator('input[placeholder="Folder name..."]').fill('public-tree');
    // Public is default, just click Create
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(1000);

    // Go back to tree list
    await page.locator(myTreesButtonSelector).click();
    await page.waitForTimeout(300);

    // Create an unlisted tree
    await page.getByRole('button', { name: 'New Folder' }).click();
    await page.locator('input[placeholder="Folder name..."]').fill('unlisted-tree');
    await page.getByRole('button', { name: /unlisted/i }).click();
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(1000);

    // Go back to tree list
    await page.locator(myTreesButtonSelector).click();
    await page.waitForTimeout(300);

    // Create a private tree
    await page.getByRole('button', { name: 'New Folder' }).click();
    await page.locator('input[placeholder="Folder name..."]').fill('private-tree');
    await page.getByRole('button', { name: /private/i }).click();
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(1000);

    // Go back to tree list
    await page.locator(myTreesButtonSelector).click();
    await page.waitForTimeout(500);

    // Verify icons for each tree type
    // Public tree should have globe icon
    const publicRow = page.locator('a:has-text("public-tree")');
    await expect(publicRow.locator('span.i-lucide-globe')).toBeVisible();

    // Unlisted tree should have link icon
    const unlistedRow = page.locator('a:has-text("unlisted-tree")');
    await expect(unlistedRow.locator('span.i-lucide-link')).toBeVisible();

    // Private tree should have lock icon
    const privateRow = page.locator('a:has-text("private-tree")');
    await expect(privateRow.locator('span.i-lucide-lock')).toBeVisible();
  });
});
