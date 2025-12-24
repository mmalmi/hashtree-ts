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
import { setupPageErrorHandler, navigateToPublicFolder, disableOthersPool, configureBlossomServers } from './test-utils.js';

test.describe('Unlisted Tree Visibility', () => {
  // Increase timeout for all tests since new user setup now creates 3 default folders
  test.setTimeout(60000);

  test.beforeEach(async ({ page }) => {
    setupPageErrorHandler(page);

    // Go to page first to be able to clear storage
    await page.goto('/');
    await disableOthersPool(page); // Prevent WebRTC cross-talk from parallel tests
    await configureBlossomServers(page);

    // Clear IndexedDB and localStorage before each test (including OPFS)
    await page.evaluate(async () => {
      const dbs = await indexedDB.databases();
      for (const db of dbs) {
        if (db.name) indexedDB.deleteDatabase(db.name);
      }
      localStorage.clear();
      sessionStorage.clear();

      // Clear OPFS
      try {
        const root = await navigator.storage.getDirectory();
        for await (const name of root.keys()) {
          await root.removeEntry(name, { recursive: true });
        }
      } catch {
        // OPFS might not be available
      }
    });

    // Reload to get truly fresh state (after clearing storage)
    await page.reload();
    await disableOthersPool(page); // Re-apply after reload
    await configureBlossomServers(page);

    // New users get auto-redirected to their public folder - wait for that
    await navigateToPublicFolder(page);
  });

  test('should create unlisted tree with ?k= param in URL', async ({ page }) => {
    // Go to user's tree list
    await page.locator('header a:has-text("Iris")').click();

    // Wait for tree list to load with New Folder button
    await expect(page.getByRole('button', { name: 'New Folder' })).toBeVisible({ timeout: 30000 });

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
    await expect(unlistedBtn).toHaveClass(/ring-accent/);

    // Create the tree
    await page.getByRole('button', { name: 'Create' }).click();

    // Wait for navigation and URL to contain ?k= parameter
    await page.waitForTimeout(1000);
    const url = page.url();
    expect(url).toContain('unlisted-test');
    expect(url).toMatch(/\?k=[a-f0-9]+/i);

    // Should show Empty directory (we're inside the tree now)
    await expect(page.getByText('Empty directory')).toBeVisible({ timeout: 30000 });
  });

  test('should show link icon for unlisted tree in tree list', async ({ page }) => {
    // Go to user's tree list
    await page.locator('header a:has-text("Iris")').click();
    await page.waitForTimeout(300);

    // Create an unlisted tree
    await page.getByRole('button', { name: 'New Folder' }).click();
    await page.locator('input[placeholder="Folder name..."]').fill('unlisted-icons');
    await page.getByRole('button', { name: /unlisted/i }).click();
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(1000);

    // Go back to tree list
    await page.locator('header a:has-text("Iris")').click();
    await page.waitForTimeout(500);

    // Find the unlisted-icons tree row and check for link icon (use file-list to avoid matching recent folders)
    const treeRow = page.getByTestId('file-list').locator('a:has-text("unlisted-icons")').first();
    await expect(treeRow).toBeVisible({ timeout: 30000 });

    // Should have link icon (i-lucide-link) for unlisted visibility
    const linkIcon = treeRow.locator('span.i-lucide-link');
    await expect(linkIcon).toBeVisible();
  });

  test('should show link icon inside unlisted tree view', async ({ page }) => {
    // Go to user's tree list
    await page.locator('header a:has-text("Iris")').click();
    await page.waitForTimeout(300);

    // Create an unlisted tree
    await page.getByRole('button', { name: 'New Folder' }).click();
    await page.locator('input[placeholder="Folder name..."]').fill('unlisted-inside');
    await page.getByRole('button', { name: /unlisted/i }).click();
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(1000);

    // Should be inside the tree now - check for link icon in the current directory row
    const currentDirRow = page.locator('a:has-text("unlisted-inside")').first();
    await expect(currentDirRow).toBeVisible({ timeout: 30000 });

    // Should have link icon for unlisted visibility inside tree view
    const linkIcon = currentDirRow.locator('span.i-lucide-link');
    await expect(linkIcon).toBeVisible();
  });

  test('should preserve ?k= param when navigating within unlisted tree', async ({ page }) => {
    // Go to user's tree list
    await page.locator('header a:has-text("Iris")').click();
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

  test('should include ?k= param when clicking unlisted tree in tree list', async ({ page }) => {
    // Go to user's tree list
    await page.locator('header a:has-text("Iris")').click();
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
    await page.locator('header a:has-text("Iris")').click();
    await page.waitForTimeout(500);

    // There are two links - one in file-list (already has ?k=) and one in RecentsView (shows "Just now")
    // We want to verify the RecentsView link also has ?k= param
    const recentsLink = page.locator('a:has-text("unlisted-click"):has-text("Just now")');

    // Verify the href includes ?k= param BEFORE clicking
    const href = await recentsLink.getAttribute('href');
    expect(href).toContain(`?k=${kParam}`);

    await recentsLink.click();
    await page.waitForTimeout(500);

    // URL should have ?k= param
    expect(page.url()).toContain(`?k=${kParam}`);
  });

  test('should create file in unlisted tree and read it back', async ({ page }) => {
    test.slow(); // File operations can be slow under parallel load
    // Go to user's tree list
    await page.locator('header a:has-text("Iris")').click();
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
    await expect(page.locator('textarea')).toBeVisible({ timeout: 30000 });

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

  test('should access unlisted tree from fresh browser with link', { timeout: 60000 }, async ({ page, browser }) => {
    test.slow(); // WebRTC and sync operations need time under parallel load
    // Add console logging for page1
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('WebRTC') || text.includes('webrtc') || text.includes('peer')) {
        console.log(`[page1] ${text}`);
      }
    });

    // Go to user's tree list
    await page.locator('header a:has-text("Iris")').click();

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

    // Verify content is visible in view mode (may take time to render under load)
    await expect(page.locator('pre')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('pre')).toHaveText('Shared secret content', { timeout: 30000 });

    // Wait for content to be published to blossom/nostr (background sync)
    await page.waitForTimeout(3000);

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

    // Add console logging for debugging
    page2.on('console', msg => {
      const text = msg.text();
      if (text.includes('WebRTC') || text.includes('webrtc') || text.includes('peer') ||
          text.includes('pending')) {
        console.log(`[page2] ${text}`);
      }
    });

    // Navigate to home first so page2 gets a user identity
    await page2.goto('http://localhost:5173');
    await disableOthersPool(page2);
    await configureBlossomServers(page2);
    await page2.waitForSelector('header span:has-text("Iris")', { timeout: 30000 });

    // Get page2's npub by clicking into their public folder
    const publicLink2 = page2.getByRole('link', { name: 'public' }).first();
    await publicLink2.click();
    await page2.waitForURL(/\/#\/npub.*\/public/, { timeout: 30000 });
    const page2Url = page2.url();
    const page2Match = page2Url.match(/npub1[a-z0-9]+/);
    if (!page2Match) throw new Error('Could not find page2 npub in URL');
    const page2Npub = page2Match[0];
    console.log(`Page2 npub: ${page2Npub.slice(0, 20)}...`);

    // Page1 follows page2 for reliable WebRTC connection in follows pool
    await page.goto(`http://localhost:5173/#/${page2Npub}`);
    const followBtn = page.getByRole('button', { name: 'Follow', exact: true });
    await expect(followBtn).toBeVisible({ timeout: 30000 });
    await followBtn.click();
    await page.waitForTimeout(500);

    // Page2 follows page1 (owner of the unlisted tree)
    await page2.goto(`http://localhost:5173/#/${npub}`);
    const followBtn2 = page2.getByRole('button', { name: 'Follow', exact: true });
    await expect(followBtn2).toBeVisible({ timeout: 30000 });
    await followBtn2.click();

    // Wait for follow to propagate via Nostr and for resolver to sync page1's trees
    // This needs time for:
    // 1. Follow event to be published to Nostr
    // 2. page1 to receive follow and potentially republish tree info
    // 3. page2's resolver to subscribe to page1's trees and receive metadata
    await page2.waitForTimeout(5000);

    // Verify page2 can see page1's unlisted tree in the tree list before navigating
    // This confirms the resolver has synced
    const treeLink = page2.getByRole('link', { name: treeName });
    await expect(treeLink).toBeVisible({ timeout: 30000 });

    // Navigate directly to the file with ?k= param
    const fileUrl = `http://localhost:5173/#/${npub}/${treeName}/shared.txt?k=${kParam}`;
    console.log(`Opening fresh browser with URL: ${fileUrl}`);
    await page2.goto(fileUrl);

    // Wait for content to load
    await page2.waitForTimeout(2000);

    // Should NOT see "Link Required" - the key should work
    await expect(page2.getByText('Link Required')).not.toBeVisible({ timeout: 30000 });

    // Verify the content is decrypted and visible (may take time to fetch from network)
    // The fix to tryConnectedPeersForHash should handle the race condition
    // In parallel test runs, the "other" pool may be full with many test instances
    // so it might take longer to connect to the right peer (page1)
    await expect(page2.locator('text="Shared secret content"')).toBeVisible({ timeout: 45000 });

    // Also verify the file link is visible (should already be there if content is visible)
    await expect(page2.locator('[data-testid="file-list"] >> text=shared.txt')).toBeVisible({ timeout: 30000 });

    // Wait 5 seconds and verify content is still visible (not replaced by "Link Required")
    await page2.waitForTimeout(5000);
    await expect(page2.getByText('Link Required')).not.toBeVisible();
    await expect(page2.locator('text="Shared secret content"')).toBeVisible({ timeout: 30000 });

    await context2.close();
  });

  test('non-owner sees "Link Required" message when accessing unlisted tree without ?k= param', { timeout: 60000 }, async ({ page, browser }) => {

    // Go to user's tree list
    await page.locator('header a:has-text("Iris")').click();
    await page.waitForTimeout(300);

    // Create an unlisted tree
    await page.getByRole('button', { name: 'New Folder' }).click();
    await page.locator('input[placeholder="Folder name..."]').fill('unlisted-no-key');
    await page.getByRole('button', { name: /unlisted/i }).click();
    await page.getByRole('button', { name: 'Create' }).click();

    // Wait for navigation to the new tree (URL should contain tree name)
    await page.waitForURL(/#\/npub[^/]+\/unlisted-no-key/, { timeout: 30000 });
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
    await expect(page2.getByText('Link Required')).toBeVisible({ timeout: 30000 });
    await expect(page2.getByText('This folder requires a special link to access')).toBeVisible();

    await context2.close();
  });

  test('owner can access unlisted tree without ?k= param (via selfEncryptedKey)', async ({ page }) => {
    // Go to user's tree list
    await page.locator('header a:has-text("Iris")').click();
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
    await expect(page.getByText('Empty directory')).toBeVisible({ timeout: 30000 });
  });

  test('should preserve ?k= param after creating file in unlisted tree', async ({ page }) => {
    test.slow(); // File operations can be slow under parallel load
    // Go to user's tree list
    await page.locator('header a:has-text("Iris")').click();
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
    test.slow(); // Upload operations can be slow under parallel load
    // Go to user's tree list
    await page.locator('header a:has-text("Iris")').click();
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
    test.slow(); // File operations can be slow under parallel load
    // This test verifies that uploading files to an unlisted tree doesn't
    // accidentally change its visibility to public (regression test for
    // autosaveIfOwn not preserving visibility)

    // Go to user's tree list
    await page.locator('header a:has-text("Iris")').click();
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
    await expect(currentDirRow).toBeVisible({ timeout: 30000 });
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
    await page.locator('header a:has-text("Iris")').click();
    await page.waitForTimeout(500);

    // CRITICAL: Verify the tree still has link icon (unlisted), NOT globe icon (public)
    const treeRow = page.getByTestId('file-list').locator('a:has-text("unlisted-stays-unlisted")').first();
    await expect(treeRow).toBeVisible({ timeout: 30000 });

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
    test.slow(); // Creates multiple trees, can be slow under parallel load
    // Go to user's tree list
    await page.locator('header a:has-text("Iris")').click();
    await page.waitForTimeout(500);

    // Create a public tree
    await page.getByRole('button', { name: 'New Folder' }).click();
    await page.locator('input[placeholder="Folder name..."]').fill('public-tree');
    // Public is default, just click Create
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(1000);

    // Go back to tree list
    await page.locator('header a:has-text("Iris")').click();
    await page.waitForTimeout(500);

    // Create an unlisted tree
    await page.getByRole('button', { name: 'New Folder' }).click();
    await page.locator('input[placeholder="Folder name..."]').fill('unlisted-tree');
    await page.getByRole('button', { name: /unlisted/i }).click();
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(1000);

    // Go back to tree list
    await page.locator('header a:has-text("Iris")').click();
    await page.waitForTimeout(500);

    // Create a private tree
    await page.getByRole('button', { name: 'New Folder' }).click();
    await page.locator('input[placeholder="Folder name..."]').fill('private-tree');
    await page.getByRole('button', { name: /private/i }).click();
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(1000);

    // Go back to tree list
    await page.locator('header a:has-text("Iris")').click();
    await page.waitForTimeout(1000);

    // Verify icons for each tree type (use file-list testid to avoid matching recent folders)
    const fileList = page.getByTestId('file-list');

    // Public tree should have globe icon
    const publicRow = fileList.locator('a:has-text("public-tree")').first();
    await expect(publicRow).toBeVisible({ timeout: 30000 });
    await expect(publicRow.locator('span.i-lucide-globe')).toBeVisible({ timeout: 30000 });

    // Unlisted tree should have link icon
    const unlistedRow = fileList.locator('a:has-text("unlisted-tree")').first();
    await expect(unlistedRow).toBeVisible({ timeout: 30000 });
    await expect(unlistedRow.locator('span.i-lucide-link')).toBeVisible({ timeout: 30000 });

    // Private tree should have lock icon
    const privateRow = fileList.locator('a:has-text("private-tree")').first();
    await expect(privateRow).toBeVisible({ timeout: 30000 });
    await expect(privateRow.locator('span.i-lucide-lock')).toBeVisible({ timeout: 30000 });
  });

  test('files in unlisted trees should be encrypted (have CHK)', async ({ page }) => {
    test.slow(); // File operations can be slow under parallel load
    // This test verifies that files uploaded to unlisted trees are properly encrypted
    // and have CHK (Content Hash Key) in the permalink

    // Go to user's tree list
    await page.locator('header a:has-text("Iris")').click();

    // Create an unlisted tree
    await page.getByRole('button', { name: 'New Folder' }).click();
    await page.locator('input[placeholder="Folder name..."]').fill('unlisted-encrypted');
    await page.getByRole('button', { name: /unlisted/i }).click();
    await page.getByRole('button', { name: 'Create' }).click();

    // Wait for tree to be created
    await expect(page.getByText('Empty directory')).toBeVisible({ timeout: 30000 });

    // Create a file with content
    await page.getByRole('button', { name: 'New File' }).click();
    await page.locator('input[placeholder="File name..."]').fill('encrypted-file.txt');
    await page.getByRole('button', { name: 'Create' }).click();

    // Type content and save
    await expect(page.locator('textarea')).toBeVisible({ timeout: 30000 });
    await page.locator('textarea').fill('This content should be encrypted');
    await page.getByRole('button', { name: 'Save' }).click();

    // Wait for save to complete (Save button becomes disabled after save)
    await expect(page.getByRole('button', { name: 'Save' }).first()).toBeDisabled({ timeout: 30000 });

    // Exit edit mode
    await page.getByRole('button', { name: 'Done' }).click();

    // Handle "Unsaved Changes" dialog if it appears (can happen due to race conditions)
    const unsavedDialog = page.getByRole('heading', { name: 'Unsaved Changes' });
    if (await unsavedDialog.isVisible({ timeout: 1000 }).catch(() => false)) {
      // Click "Don't Save" since we already saved
      await page.getByRole('button', { name: "Don't Save" }).click();
    }

    // Wait for file viewer to load (may take time under parallel load)
    // Look for the content text first as it's more reliable than the pre element
    await expect(page.getByText('This content should be encrypted')).toBeVisible({ timeout: 30000 });

    // Look for the file's Permalink link (the one with visible text, not just icon)
    const permalinkLink = page.getByRole('link', { name: 'Permalink' });
    await expect(permalinkLink).toBeVisible({ timeout: 15000 });

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
    test.slow(); // File operations can be slow under parallel load
    // Go to user's tree list
    await page.locator('header a:has-text("Iris")').click();
    await page.waitForTimeout(300);

    // Create a private tree
    await page.getByRole('button', { name: 'New Folder' }).click();
    await page.locator('input[placeholder="Folder name..."]').fill('my-private');
    await page.getByRole('button', { name: /private/i }).click();
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(2000);

    // Should be inside the private tree now, not showing "Link Required"
    // The owner should be able to see the folder contents
    await expect(page.locator('text="Link Required"')).not.toBeVisible({ timeout: 30000 });
    await expect(page.locator('text="Private Folder"')).not.toBeVisible({ timeout: 30000 });

    // Wait for the UI to be ready and find the New file button
    await page.waitForTimeout(1000);

    // Create a new file in the private tree
    await page.getByRole('button', { name: 'New File' }).click({ timeout: 30000 });
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
    await expect(page.locator('pre')).toHaveText('My secret content', { timeout: 30000 });

    // Navigate away and back to verify persistence
    await page.locator('header a:has-text("Iris")').click();
    await page.waitForTimeout(500);

    // Click on the private tree
    await page.getByTestId('file-list').locator('a:has-text("my-private")').first().click();
    await page.waitForTimeout(2000);

    // Should still not show the locked message
    await expect(page.locator('text="Link Required"')).not.toBeVisible({ timeout: 30000 });
    await expect(page.locator('text="Private Folder"')).not.toBeVisible({ timeout: 30000 });

    // The file should be visible
    await expect(page.locator('text="secret.txt"')).toBeVisible({ timeout: 30000 });
  });
});
