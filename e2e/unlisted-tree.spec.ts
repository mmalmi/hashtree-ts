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
import { setupPageErrorHandler, navigateToPublicFolder } from './test-utils.js';

test.describe('Unlisted Tree Visibility', () => {
  // Increase timeout for all tests since new user setup now creates 3 default folders
  test.setTimeout(60000);

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

    // New users get auto-redirected to their public folder - wait for that
    await navigateToPublicFolder(page);
  });

  test('should create unlisted tree with ?k= param in URL', async ({ page }) => {
    // Go to user's tree list
    await page.locator('header a:has-text("hashtree")').click();

    // Wait for tree list to load with New Folder button
    await expect(page.getByRole('button', { name: 'New Folder' })).toBeVisible({ timeout: 10000 });

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
    await page.locator('header a:has-text("hashtree")').click();
    await page.waitForTimeout(300);

    // Create an unlisted tree
    await page.getByRole('button', { name: 'New Folder' }).click();
    await page.locator('input[placeholder="Folder name..."]').fill('unlisted-icons');
    await page.getByRole('button', { name: /unlisted/i }).click();
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(1000);

    // Go back to tree list
    await page.locator('header a:has-text("hashtree")').click();
    await page.waitForTimeout(500);

    // Find the unlisted-icons tree row and check for link icon (use file-list to avoid matching recent folders)
    const treeRow = page.getByTestId('file-list').locator('a:has-text("unlisted-icons")').first();
    await expect(treeRow).toBeVisible({ timeout: 5000 });

    // Should have link icon (i-lucide-link) for unlisted visibility
    const linkIcon = treeRow.locator('span.i-lucide-link');
    await expect(linkIcon).toBeVisible();
  });

  test('should show link icon inside unlisted tree view', async ({ page }) => {
    // Go to user's tree list
    await page.locator('header a:has-text("hashtree")').click();
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

  // SKIP: ".." navigation at tree root goes to profile - separate bug to investigate
  test.skip('should preserve ?k= param when navigating within unlisted tree', async ({ page }) => {
    // Go to user's tree list
    await page.locator('header a:has-text("hashtree")').click();
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

    // Create a subfolder first (before creating files, to avoid edit mode)
    await page.getByRole('button', { name: /Folder/ }).first().click();
    await page.locator('input[placeholder="Folder name..."]').fill('subfolder');
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(500);

    // URL should still have ?k= param
    expect(page.url()).toContain(`?k=${kParam}`);

    // Click on subfolder to navigate into it
    await page.locator('a:has-text("subfolder")').click();
    await page.waitForTimeout(500);

    // URL should still have ?k= param and include subfolder
    expect(page.url()).toContain(`?k=${kParam}`);
    expect(page.url()).toContain('subfolder');

    // Go back to parent using ".."
    await page.locator('a:has-text("..")').first().click();
    await page.waitForTimeout(500);

    // URL should still have ?k= param (back at tree root)
    expect(page.url()).toContain(`?k=${kParam}`);
    expect(page.url()).toContain('unlisted-nav');
  });

  // SKIP: ?k= param not preserved when clicking unlisted tree - app bug to investigate
  test.skip('should include ?k= param when clicking unlisted tree in tree list', async ({ page }) => {
    // Go to user's tree list
    await page.locator('header a:has-text("hashtree")').click();
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
    await page.locator('header a:has-text("hashtree")').click();
    await page.waitForTimeout(500);

    // Click on the unlisted tree
    await page.locator('a:has-text("unlisted-click")').click();
    await page.waitForTimeout(500);

    // URL should have ?k= param
    expect(page.url()).toContain(`?k=${kParam}`);
  });

  test('should create file in unlisted tree and read it back', async ({ page }) => {
    // Go to user's tree list
    await page.locator('header a:has-text("hashtree")').click();
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

  // Skip: WebRTC sync between browser contexts unreliable in CI
  test.skip('should access unlisted tree from fresh browser with link', async ({ page, browser }) => {
    // Go to user's tree list
    await page.locator('header a:has-text("hashtree")').click();

    // Create an unlisted tree
    await page.getByRole('button', { name: 'New Folder' }).click();
    await page.locator('input[placeholder="Folder name..."]').fill('unlisted-share');
    await page.getByRole('button', { name: /unlisted/i }).click();
    await page.getByRole('button', { name: 'Create' }).click();

    // Wait for tree to be created
    await expect(page.getByText('Empty directory')).toBeVisible();

    // Create a file with content
    await page.getByRole('button', { name: /File/ }).first().click();
    await page.locator('input[placeholder="File name..."]').fill('shared.txt');
    await page.getByRole('button', { name: 'Create' }).click();

    // Type content and save
    await expect(page.locator('textarea')).toBeVisible();
    await page.locator('textarea').fill('Shared secret content');
    await page.getByRole('button', { name: 'Save' }).click();

    // Exit edit mode so content is saved properly
    await page.getByRole('button', { name: 'Done' }).click();

    // Verify content is visible in view mode
    await expect(page.locator('pre')).toHaveText('Shared secret content');

    // Get the URL (should not have &edit=1 now)
    const shareUrl = page.url();
    expect(shareUrl).toMatch(/\?k=[a-f0-9]+/i);

    // Extract npub, treeName, and k param
    const urlMatch = shareUrl.match(/#\/(npub[^/]+)\/([^/?]+).*\?k=([a-f0-9]+)/i);
    expect(urlMatch).toBeTruthy();
    const [, npub, treeName, kParam] = urlMatch!;

    // Open fresh browser context (no cookies, no localStorage)
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    setupPageErrorHandler(page2);

    // Navigate directly to the file with ?k= param
    const fileUrl = `http://localhost:5173/#/${npub}/${treeName}/shared.txt?k=${kParam}`;
    await page2.goto(fileUrl);

    // Should NOT see "Link Required" - the key should work
    await expect(page2.getByText('Link Required')).not.toBeVisible();

    // Verify the file is visible in the second browser
    // The content should be decrypted using the linkKey from the URL
    await expect(page2.locator('text="shared.txt"').first()).toBeVisible();

    // Verify the content is decrypted and visible (may take time to fetch from network)
    await expect(page2.locator('text="Shared secret content"')).toBeVisible({ timeout: 10000 });

    // Wait 5 seconds and verify content is still visible (not replaced by "Link Required")
    await page2.waitForTimeout(5000);
    await expect(page2.getByText('Link Required')).not.toBeVisible();
    await expect(page2.locator('text="Shared secret content"')).toBeVisible({ timeout: 5000 });

    await context2.close();
  });

  test('non-owner sees "Link Required" message when accessing unlisted tree without ?k= param', { timeout: 60000 }, async ({ page, browser }) => {

    // Go to user's tree list
    await page.locator('header a:has-text("hashtree")').click();
    await page.waitForTimeout(300);

    // Create an unlisted tree
    await page.getByRole('button', { name: 'New Folder' }).click();
    await page.locator('input[placeholder="Folder name..."]').fill('unlisted-no-key');
    await page.getByRole('button', { name: /unlisted/i }).click();
    await page.getByRole('button', { name: 'Create' }).click();

    // Wait for navigation to the new tree (URL should contain tree name)
    await page.waitForURL(/#\/npub[^/]+\/unlisted-no-key/, { timeout: 10000 });
    await page.waitForTimeout(1000);

    // Extract npub and treeName from URL
    const shareUrl = page.url();
    console.log('Owner URL after creating unlisted tree:', shareUrl);
    const urlMatch = shareUrl.match(/#\/(npub[^/]+)\/([^/?]+)/);
    expect(urlMatch).toBeTruthy();
    const [, npub, treeName] = urlMatch!;

    // Open fresh browser (non-owner) and try to access WITHOUT ?k= param
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    setupPageErrorHandler(page2);

    // Navigate to tree WITHOUT ?k= param - should show locked indicator
    const treeUrlWithoutKey = `http://localhost:5173/#/${npub}/${treeName}`;
    await page2.goto(treeUrlWithoutKey);
    await page2.waitForTimeout(3000);

    // Should see "Link Required" message
    await expect(page2.getByText('Link Required')).toBeVisible({ timeout: 10000 });
    await expect(page2.getByText('This folder requires a special link to access')).toBeVisible();

    await context2.close();
  });

  test('owner can access unlisted tree without ?k= param (via selfEncryptedKey)', async ({ page }) => {
    // Go to user's tree list
    await page.locator('header a:has-text("hashtree")').click();
    await page.waitForTimeout(300);

    // Create an unlisted tree
    await page.getByRole('button', { name: 'New Folder' }).click();
    await page.locator('input[placeholder="Folder name..."]').fill('unlisted-owner');
    await page.getByRole('button', { name: /unlisted/i }).click();
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(1000);

    // Get URL with ?k= and then navigate WITHOUT it
    const shareUrl = page.url();
    const urlMatch = shareUrl.match(/#\/(npub[^/]+)\/([^/?]+)/);
    expect(urlMatch).toBeTruthy();
    const [, npub, treeName] = urlMatch!;

    // Navigate to tree WITHOUT ?k= param (owner should still have access via selfEncryptedKey)
    const treeUrlWithoutKey = `http://localhost:5173/#/${npub}/${treeName}`;
    await page.goto(treeUrlWithoutKey);
    await page.waitForTimeout(1000);

    // Owner should still be able to access (via selfEncryptedKey decryption)
    // The tree should show "Empty directory" since owner can decrypt
    await expect(page.getByText('Empty directory')).toBeVisible({ timeout: 10000 });
  });

  test('should preserve ?k= param after creating file in unlisted tree', async ({ page }) => {
    // Go to user's tree list
    await page.locator('header a:has-text("hashtree")').click();
    await page.waitForTimeout(300);

    // Create an unlisted tree
    await page.getByRole('button', { name: 'New Folder' }).click();
    await page.locator('input[placeholder="Folder name..."]').fill('unlisted-upload');
    await page.getByRole('button', { name: /unlisted/i }).click();
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(1000);

    // Get URL with ?k= and verify it's there
    const initialUrl = page.url();
    expect(initialUrl).toMatch(/\?k=[a-f0-9]+/i);
    const kParam = initialUrl.match(/\?k=([a-f0-9]+)/i)?.[1];
    expect(kParam).toBeTruthy();

    // Create a new file using the File button
    await page.getByRole('button', { name: /File/ }).first().click();
    await page.locator('input[placeholder="File name..."]').fill('uploaded.txt');
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(500);

    // Now we're in edit mode with an empty file, type content and save
    await page.locator('textarea').fill('Test file content for upload');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.waitForTimeout(1000);

    // Check URL still has ?k= param after saving the file
    const urlAfterSave = page.url();
    expect(urlAfterSave).toContain(`?k=${kParam}`);

    // Exit edit mode
    await page.getByRole('button', { name: 'Done' }).click();
    await page.waitForTimeout(500);

    // Check URL still has ?k= param after exiting edit mode
    const urlAfterDone = page.url();
    expect(urlAfterDone).toContain(`?k=${kParam}`);
  });

  test('should preserve ?k= param after drag-and-drop upload to unlisted tree', async ({ page }) => {
    // Go to user's tree list
    await page.locator('header a:has-text("hashtree")').click();
    await page.waitForTimeout(300);

    // Create an unlisted tree
    await page.getByRole('button', { name: 'New Folder' }).click();
    await page.locator('input[placeholder="Folder name..."]').fill('unlisted-dnd');
    await page.getByRole('button', { name: /unlisted/i }).click();
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(1000);

    // Get URL with ?k= and verify it's there
    const initialUrl = page.url();
    expect(initialUrl).toMatch(/\?k=[a-f0-9]+/i);
    const kParam = initialUrl.match(/\?k=([a-f0-9]+)/i)?.[1];
    expect(kParam).toBeTruthy();

    // Create a buffer for the file content
    const buffer = Buffer.from('Drag and drop test content');

    // Use Playwright's setInputFiles on the hidden file input if there is one
    // Or simulate drag and drop via the DataTransfer API
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    await page.evaluate(([dt, content]) => {
      const file = new File([new Uint8Array(content)], 'dropped.txt', { type: 'text/plain' });
      (dt as DataTransfer).items.add(file);
    }, [dataTransfer, [...buffer]] as const);

    // Find the drop target and dispatch events
    const dropTarget = page.locator('body');
    await dropTarget.dispatchEvent('dragenter', { dataTransfer });
    await dropTarget.dispatchEvent('dragover', { dataTransfer });
    await dropTarget.dispatchEvent('drop', { dataTransfer });

    // Wait for upload to complete and file to appear
    await page.waitForTimeout(3000);

    // Check if file appeared
    const fileVisible = await page.locator('text="dropped.txt"').isVisible().catch(() => false);
    console.log('File visible after drop:', fileVisible);

    // Check URL still has ?k= param
    const urlAfterDrop = page.url();
    console.log('URL after drop:', urlAfterDrop);
    expect(urlAfterDrop).toContain(`?k=${kParam}`);
  });

  test('unlisted tree should remain unlisted after file upload (not become public)', async ({ page }) => {
    // This test verifies that uploading files to an unlisted tree doesn't
    // accidentally change its visibility to public (regression test for
    // autosaveIfOwn not preserving visibility)

    // Go to user's tree list
    await page.locator('header a:has-text("hashtree")').click();
    await page.waitForTimeout(300);

    // Create an unlisted tree
    await page.getByRole('button', { name: 'New Folder' }).click();
    await page.locator('input[placeholder="Folder name..."]').fill('unlisted-stays-unlisted');
    await page.getByRole('button', { name: /unlisted/i }).click();
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(1000);

    // Get URL with ?k= param
    const initialUrl = page.url();
    expect(initialUrl).toMatch(/\?k=[a-f0-9]+/i);
    const kParam = initialUrl.match(/\?k=([a-f0-9]+)/i)?.[1];
    expect(kParam).toBeTruthy();

    // Verify the tree shows link icon (unlisted)
    const currentDirRow = page.locator('a:has-text("unlisted-stays-unlisted")').first();
    await expect(currentDirRow).toBeVisible({ timeout: 5000 });
    await expect(currentDirRow.locator('span.i-lucide-link')).toBeVisible();

    // Create a file using the File button (simulates upload to the tree)
    await page.getByRole('button', { name: /File/ }).first().click();
    await page.locator('input[placeholder="File name..."]').fill('visibility-test.txt');
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(500);

    // Type content and save
    await page.locator('textarea').fill('Test content for visibility check');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.waitForTimeout(1000);

    // Exit edit mode
    await page.getByRole('button', { name: 'Done' }).click();
    await page.waitForTimeout(500);

    // Go back to tree list
    await page.locator('header a:has-text("hashtree")').click();
    await page.waitForTimeout(500);

    // CRITICAL: Verify the tree still has link icon (unlisted), NOT globe icon (public)
    const treeRow = page.getByTestId('file-list').locator('a:has-text("unlisted-stays-unlisted")').first();
    await expect(treeRow).toBeVisible({ timeout: 5000 });

    // Should have link icon (unlisted), not globe icon (public)
    await expect(treeRow.locator('span.i-lucide-link')).toBeVisible();

    // Should NOT have globe icon (public)
    const globeIcon = treeRow.locator('span.i-lucide-globe');
    await expect(globeIcon).not.toBeVisible();

    // Click on the tree and verify ?k= param is still in URL
    await treeRow.click();
    await page.waitForTimeout(500);
    expect(page.url()).toContain(`?k=${kParam}`);
  });

  test('should show correct visibility icons for different tree types', async ({ page }) => {
    // Go to user's tree list
    await page.locator('header a:has-text("hashtree")').click();
    await page.waitForTimeout(500);

    // Create a public tree
    await page.getByRole('button', { name: 'New Folder' }).click();
    await page.locator('input[placeholder="Folder name..."]').fill('public-tree');
    // Public is default, just click Create
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(1000);

    // Go back to tree list
    await page.locator('header a:has-text("hashtree")').click();
    await page.waitForTimeout(500);

    // Create an unlisted tree
    await page.getByRole('button', { name: 'New Folder' }).click();
    await page.locator('input[placeholder="Folder name..."]').fill('unlisted-tree');
    await page.getByRole('button', { name: /unlisted/i }).click();
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(1000);

    // Go back to tree list
    await page.locator('header a:has-text("hashtree")').click();
    await page.waitForTimeout(500);

    // Create a private tree
    await page.getByRole('button', { name: 'New Folder' }).click();
    await page.locator('input[placeholder="Folder name..."]').fill('private-tree');
    await page.getByRole('button', { name: /private/i }).click();
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(1000);

    // Go back to tree list
    await page.locator('header a:has-text("hashtree")').click();
    await page.waitForTimeout(1000);

    // Verify icons for each tree type (use file-list testid to avoid matching recent folders)
    const fileList = page.getByTestId('file-list');

    // Public tree should have globe icon
    const publicRow = fileList.locator('a:has-text("public-tree")').first();
    await expect(publicRow).toBeVisible({ timeout: 5000 });
    await expect(publicRow.locator('span.i-lucide-globe')).toBeVisible({ timeout: 5000 });

    // Unlisted tree should have link icon
    const unlistedRow = fileList.locator('a:has-text("unlisted-tree")').first();
    await expect(unlistedRow).toBeVisible({ timeout: 5000 });
    await expect(unlistedRow.locator('span.i-lucide-link')).toBeVisible({ timeout: 5000 });

    // Private tree should have lock icon
    const privateRow = fileList.locator('a:has-text("private-tree")').first();
    await expect(privateRow).toBeVisible({ timeout: 5000 });
    await expect(privateRow.locator('span.i-lucide-lock')).toBeVisible({ timeout: 5000 });
  });

  test('files in unlisted trees should be encrypted (have CHK)', async ({ page }) => {
    // This test verifies that files uploaded to unlisted trees are properly encrypted
    // and have CHK (Content Hash Key) in the permalink

    // Go to user's tree list
    await page.locator('header a:has-text("hashtree")').click();

    // Create an unlisted tree
    await page.getByRole('button', { name: 'New Folder' }).click();
    await page.locator('input[placeholder="Folder name..."]').fill('unlisted-encrypted');
    await page.getByRole('button', { name: /unlisted/i }).click();
    await page.getByRole('button', { name: 'Create' }).click();

    // Wait for tree to be created
    await expect(page.getByText('Empty directory')).toBeVisible({ timeout: 5000 });

    // Create a file with content
    await page.getByRole('button', { name: 'New File' }).click();
    await page.locator('input[placeholder="File name..."]').fill('encrypted-file.txt');
    await page.getByRole('button', { name: 'Create' }).click();

    // Type content and save
    await expect(page.locator('textarea')).toBeVisible({ timeout: 5000 });
    await page.locator('textarea').fill('This content should be encrypted');
    await page.getByRole('button', { name: 'Save' }).click();

    // Exit edit mode
    await page.getByRole('button', { name: 'Done' }).click();

    // Look for the file's Permalink link (the one with visible text, not just icon)
    const permalinkLink = page.getByRole('link', { name: 'Permalink' });
    await expect(permalinkLink).toBeVisible({ timeout: 5000 });

    // Get the href of the permalink
    const permalinkHref = await permalinkLink.getAttribute('href');
    console.log('Permalink href:', permalinkHref);
    expect(permalinkHref).toBeTruthy();

    // The nhash should be longer than 32 bytes (simple hash) if it includes a key
    // Simple nhash (32 bytes hash) = ~58 chars (nhash1 + bech32 of 32 bytes)
    // TLV nhash with key should be longer since it includes hash TLV + key TLV
    const nhashMatch = permalinkHref!.match(/nhash1[a-z0-9]+/);
    expect(nhashMatch).toBeTruthy();
    const nhash = nhashMatch![0];
    console.log('nhash:', nhash);
    console.log('nhash length:', nhash.length);

    // A simple 32-byte hash encoded in bech32 is about 58 chars
    // With TLV (hash + key), it should be longer (around 115+ chars)
    // If the file is encrypted, the nhash should include the decrypt key
    expect(nhash.length).toBeGreaterThan(70); // Should have TLV encoding with key
  });

  test('owner can create and write to private folder', { timeout: 60000 }, async ({ page }) => {
    // Go to user's tree list
    await page.locator('header a:has-text("hashtree")').click();
    await page.waitForTimeout(300);

    // Create a private tree
    await page.getByRole('button', { name: 'New Folder' }).click();
    await page.locator('input[placeholder="Folder name..."]').fill('my-private');
    await page.getByRole('button', { name: /private/i }).click();
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(2000);

    // Should be inside the private tree now, not showing "Link Required"
    // The owner should be able to see the folder contents
    await expect(page.locator('text="Link Required"')).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator('text="Private Folder"')).not.toBeVisible({ timeout: 5000 });

    // Wait for the UI to be ready and find the New file button
    await page.waitForTimeout(1000);

    // Create a new file in the private tree
    await page.getByRole('button', { name: 'New File' }).click({ timeout: 10000 });
    await page.locator('input[placeholder="File name..."]').fill('secret.txt');
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(500);

    // Type content and save
    await page.locator('textarea').fill('My secret content');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.waitForTimeout(2000);

    // Exit edit mode
    await page.getByRole('button', { name: 'Done' }).click();
    await page.waitForTimeout(1000);

    // Verify content is visible
    await expect(page.locator('pre')).toHaveText('My secret content', { timeout: 5000 });

    // Navigate away and back to verify persistence
    await page.locator('header a:has-text("hashtree")').click();
    await page.waitForTimeout(500);

    // Click on the private tree
    await page.getByTestId('file-list').locator('a:has-text("my-private")').first().click();
    await page.waitForTimeout(2000);

    // Should still not show the locked message
    await expect(page.locator('text="Link Required"')).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator('text="Private Folder"')).not.toBeVisible({ timeout: 5000 });

    // The file should be visible
    await expect(page.locator('text="secret.txt"')).toBeVisible({ timeout: 5000 });
  });
});
