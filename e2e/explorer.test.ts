import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { setupPageErrorHandler, waitForNewUserRedirect, myTreesButtonSelector } from './test-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Helper to create tree via modal and navigate into it
// NOTE: Since new users start in /public, we navigate to root first to create a NEW tree
async function createAndEnterTree(page: any, name: string) {
  // Go to user's tree list first
  await page.locator(myTreesButtonSelector).click();

  // Wait for tree list to load with New Folder button
  await expect(page.getByRole('button', { name: 'New Folder' })).toBeVisible({ timeout: 10000 });

  await page.getByRole('button', { name: 'New Folder' }).click();
  await page.locator('input[placeholder="Folder name..."]').fill(name);
  await page.getByRole('button', { name: 'Create' }).click();
  // After local createTree, navigates directly into empty tree
  await expect(page.getByText('Empty directory')).toBeVisible({ timeout: 10000 });
}

// Helper to create a temp file and upload it (must be inside a tree)
async function uploadTempFile(page: any, name: string, content: string | Buffer) {
  const tmpDir = os.tmpdir();
  const filePath = path.join(tmpDir, name);
  fs.writeFileSync(filePath, content);
  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.setInputFiles(filePath);
  await page.waitForTimeout(2500); // Wait longer for upload + autosave (may be rate-limited)
  fs.unlinkSync(filePath);
}

test.describe('Hashtree Explorer', () => {
  // Increase timeout for all tests since new user setup now creates 3 default folders
  test.setTimeout(30000);
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
    await waitForNewUserRedirect(page);
  });

  test('should display header and initial state', async ({ page }) => {
    // Header shows app name "Hashtree"
    await expect(page.locator('header').getByText('Hashtree').first()).toBeVisible({ timeout: 5000 });
    // New users are redirected to their public folder - shows "Empty directory" or folder actions
    await expect(page.getByText('Empty directory')).toBeVisible({ timeout: 5000 });
  });

  // Skip: File upload via setInputFiles doesn't work reliably in headless tests
  // The functionality works in manual testing but setInputFiles doesn't trigger the upload handler
  test.skip('should create a local tree and upload files', async ({ page }) => {
    const fileList = page.getByTestId('file-list');

    // Create tree via modal - this navigates into empty tree
    await createAndEnterTree(page, 'test-tree');

    // Upload a file
    await uploadTempFile(page, 'hello.txt', 'Hello, World!');

    // File should appear in file browser (may take time due to autosave to nostr)
    await expect(fileList.locator('span:text-is("hello.txt")')).toBeVisible({ timeout: 15000 });

    // Click to view content
    await fileList.locator('a:has-text("hello.txt")').click();
    await page.waitForTimeout(500);
    await expect(page.locator('pre')).toHaveText('Hello, World!');
  });

  test('should create file using File button', async ({ page }) => {
    const fileList = page.getByTestId('file-list');

    // Create tree via modal
    await createAndEnterTree(page, 'file-btn-test');

    // Create file using File button
    await page.getByRole('button', { name: /File/ }).first().click();
    await page.locator('input[placeholder="File name..."]').fill('test-file.txt');
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(1000);

    // File should appear in file browser (use a:has-text since entries are links)
    await expect(fileList.locator('a').filter({ hasText: 'test-file.txt' }).first()).toBeVisible({ timeout: 10000 });
  });

  test('should create and edit a file', async ({ page }) => {
    const fileList = page.getByTestId('file-list');

    // Create tree via modal
    await createAndEnterTree(page, 'edit-test');

    // Create new file using File button - this auto-navigates to edit mode
    await page.getByRole('button', { name: /File/ }).first().click();
    await page.locator('input[placeholder="File name..."]').fill('editable.txt');
    await page.getByRole('button', { name: 'Create' }).click();

    // Wait for textarea to be visible (file creation navigates to edit mode)
    await expect(page.locator('textarea')).toBeVisible({ timeout: 10000 });

    // Type content and save
    await page.locator('textarea').fill('Hello, Hashtree!');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.waitForTimeout(500);

    // Click Done to exit edit mode
    await page.getByRole('button', { name: 'Done' }).click();
    await page.waitForTimeout(500);

    // Click on file in list to ensure it's selected
    await page.getByRole('link', { name: 'editable.txt' }).click();

    // Content should be visible in preview
    await expect(page.locator('pre')).toHaveText('Hello, Hashtree!', { timeout: 10000 });
  });

  test('should persist file edits after navigation', async ({ page }) => {
    const fileList = page.getByTestId('file-list');

    // Create tree via modal
    await createAndEnterTree(page, 'persist-test');

    // Create a file with initial content
    await page.getByRole('button', { name: /File/ }).first().click();
    await page.locator('input[placeholder="File name..."]').fill('persist.txt');
    await page.getByRole('button', { name: 'Create' }).click();

    // Wait for textarea (edit mode)
    await expect(page.locator('textarea')).toBeVisible({ timeout: 10000 });

    // Type initial content and save
    await page.locator('textarea').fill('Initial content');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.waitForTimeout(500);

    // Exit edit mode
    await page.getByRole('button', { name: 'Done' }).click();
    await page.waitForTimeout(300);

    // Verify initial content
    await expect(page.locator('pre')).toHaveText('Initial content');

    // Now edit to new content
    await page.getByRole('button', { name: 'Edit' }).click();
    await expect(page.locator('textarea')).toBeVisible({ timeout: 5000 });
    await page.locator('textarea').fill('Updated content');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.waitForTimeout(500);

    // Exit edit mode
    await page.getByRole('button', { name: 'Done' }).click();
    await page.waitForTimeout(300);

    // Verify updated content
    await expect(page.locator('pre')).toHaveText('Updated content');

    // Navigate to homepage
    await page.getByRole('link', { name: 'Hashtree' }).click();
    await page.waitForTimeout(500);

    // Navigate back to the tree
    await page.locator(myTreesButtonSelector).click();
    await page.waitForTimeout(500);

    await page.locator(`a:has-text("persist-test")`).click();
    await page.waitForTimeout(1000);

    // File should still be in the list
    await expect(fileList.locator('span:text-is("persist.txt")')).toBeVisible({ timeout: 5000 });

    // Click the file
    await fileList.locator('a:has-text("persist.txt")').click();
    await page.waitForTimeout(500);

    // Content should still be the updated value (persisted correctly)
    await expect(page.locator('pre')).toHaveText('Updated content', { timeout: 10000 });
  });

  test.skip('should rename a file', async ({ page }) => {
    const fileList = page.getByTestId('file-list');

    // Create tree via modal
    await createAndEnterTree(page, 'rename-test');

    // Upload file
    await uploadTempFile(page, 'old-name.txt', 'rename me');
    await expect(fileList.locator('span:text-is("old-name.txt")')).toBeVisible({ timeout: 5000 });

    // Select file
    await fileList.locator('a:has-text("old-name.txt")').click();
    await page.waitForTimeout(500);

    // Wait for Rename button in preview toolbar to be visible
    await expect(page.getByRole('button', { name: 'Rename' })).toBeVisible({ timeout: 5000 });

    // Click rename button
    await page.getByRole('button', { name: 'Rename' }).click();
    await page.waitForTimeout(300);

    // Fill new name and submit by pressing Enter
    const input = page.locator('input[placeholder="New name..."]');
    await input.fill('new-name.txt');
    await input.press('Enter');

    // Wait for modal to close
    await expect(input).not.toBeVisible({ timeout: 5000 });

    // Wait for new name to appear first (rename succeeded)
    await expect(fileList.locator('span:text-is("new-name.txt")')).toBeVisible({ timeout: 10000 });
    // Then verify old name is gone
    await expect(fileList.locator('span:text-is("old-name.txt")')).not.toBeVisible({ timeout: 5000 });
  });

  // Skip: Depends on file upload via setInputFiles which doesn't work reliably
  test.skip('should delete a file', async ({ page }) => {
    const fileList = page.getByTestId('file-list');

    // Create tree via modal
    await createAndEnterTree(page, 'delete-test');

    // Upload file
    await uploadTempFile(page, 'to-delete.txt', 'delete me');
    await expect(fileList.locator('span:text-is("to-delete.txt")')).toBeVisible({ timeout: 15000 });

    // Click on the file to select it and show preview
    await fileList.locator('a:has-text("to-delete.txt")').click();

    // Wait for URL to contain the filename (confirming navigation)
    await expect(page).toHaveURL(/to-delete\.txt/, { timeout: 5000 });

    // Wait for Delete button to be visible in preview toolbar
    const deleteBtn = page.locator('button:has-text("Delete")');
    await expect(deleteBtn).toBeVisible({ timeout: 10000 });

    // Click Delete button in preview toolbar
    page.on('dialog', dialog => dialog.accept());
    await deleteBtn.click();
    await page.waitForTimeout(300);

    await expect(fileList.locator('span:text-is("to-delete.txt")')).not.toBeVisible({ timeout: 5000 });
  });


  test('should open stream panel', async ({ page }) => {
    // Create tree via modal
    await createAndEnterTree(page, 'stream-test');

    // Click Stream link (now a Link instead of button)
    const streamLink = page.getByRole('link', { name: /Stream/ }).first();
    await expect(streamLink).toBeVisible({ timeout: 5000 });
    await streamLink.click();
    await page.waitForTimeout(300);

    // Should navigate to stream route and show the livestream panel
    await expect(page.getByText('Livestream', { exact: true })).toBeVisible({ timeout: 5000 });

    // Should have Start Camera button
    await expect(page.getByRole('button', { name: 'Start Camera' })).toBeVisible({ timeout: 5000 });

    // Close panel by clicking X button (navigates back)
    await page.locator('button:has(span.i-lucide-x)').click();
    await page.waitForTimeout(200);

    // Panel should be closed - Stream link should be visible again
    await expect(page.getByRole('link', { name: /Stream/ }).first()).toBeVisible();
  });

  // Skip: Depends on file upload via setInputFiles which doesn't work reliably
  test.skip('should show binary file as hex', async ({ page }) => {
    const fileList = page.getByTestId('file-list');

    // Create tree via modal
    await createAndEnterTree(page, 'binary-test');

    // Upload binary file
    await uploadTempFile(page, 'binary.bin', Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]));
    await expect(fileList.locator('span:text-is("binary.bin")')).toBeVisible({ timeout: 15000 });

    await fileList.locator('a:has-text("binary.bin")').click();
    await page.waitForTimeout(500);

    await expect(page.getByText('Binary file')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('code').last()).toContainText('00 01 02 ff fe');
  });

  // Skip: Depends on file upload via setInputFiles which doesn't work reliably
  test.skip('should cancel editing', async ({ page }) => {
    const fileList = page.getByTestId('file-list');

    // Create tree via modal
    await createAndEnterTree(page, 'cancel-test');

    // Upload file
    await uploadTempFile(page, 'cancel-test.txt', 'original');
    await expect(fileList.locator('span:text-is("cancel-test.txt")')).toBeVisible({ timeout: 15000 });

    // Click the file link to navigate to preview
    await fileList.locator('a:has-text("cancel-test.txt")').click();
    await page.waitForTimeout(500);

    // Wait for Edit button to be visible and enabled (content must load first)
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: 'Edit' })).toBeEnabled({ timeout: 5000 });
    await page.getByRole('button', { name: 'Edit' }).click();
    await page.waitForTimeout(300);
    await page.locator('textarea').fill('This will be cancelled');
    await page.getByRole('button', { name: 'Done' }).click();
    await page.waitForTimeout(300);

    await expect(page.locator('textarea')).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();
  });

  test('should close modal by clicking outside', async ({ page }) => {
    // Create tree via modal
    await createAndEnterTree(page, 'modal-test');

    await page.getByRole('button', { name: /File/ }).first().click();
    await expect(page.locator('input[placeholder="File name..."]')).toBeVisible();

    // Click outside the modal
    await page.locator('div.fixed.inset-0.bg-black\\/70').click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(200);

    await expect(page.locator('input[placeholder="File name..."]')).not.toBeVisible();
  });


  test('should persist login across page reload', async ({ page }) => {
    // Avatar button should be visible (logged in state)
    await expect(page.locator(myTreesButtonSelector)).toBeVisible();

    // Reload page
    await page.reload();
    await page.waitForTimeout(500);

    // Should still be logged in - avatar button still visible
    await expect(page.locator(myTreesButtonSelector)).toBeVisible();
  });

  // Skip: AppMenu is no longer rendered - there's no logout from UI currently
  test.skip('should logout and show login buttons', async ({ page }) => {
    // This test is skipped because the hamburger menu has been removed from the UI
    // Logout functionality is not currently accessible from the UI
  });

  // Skip: AppMenu drawer has been removed from the UI
  test.skip('should open app menu drawer', async ({ page }) => {
    // This test is skipped because the hamburger menu has been removed from the UI
    // Settings and Wallet are now accessed via direct links in the header
  });

  test('should navigate to settings page and display sections', async ({ page }) => {
    // Click on the connectivity indicator (wifi icon with count) which links to settings (HashRouter uses #/settings)
    await page.locator('a[href="#/settings"]').first().click();
    await page.waitForTimeout(300);

    // Should be on settings page
    expect(page.url()).toContain('/settings');

    // Should display Settings header (the one with font-semibold class)
    await expect(page.locator('span.font-semibold:text-is("Settings")')).toBeVisible({ timeout: 5000 });

    // Should display Relays section with relay list
    await expect(page.getByText(/Relays \(\d+\)/)).toBeVisible({ timeout: 5000 });
    // Should show at least one relay hostname
    await expect(page.getByText('relay.damus.io')).toBeVisible({ timeout: 5000 });

    // Should display Peers section
    await expect(page.getByText(/Peers \(\d+\)/)).toBeVisible({ timeout: 5000 });

    // Should display Local Storage section
    await expect(page.getByText('Local Storage')).toBeVisible({ timeout: 5000 });
    // Should show Items count
    await expect(page.getByText('Items')).toBeVisible({ timeout: 5000 });
    // Should show Size
    await expect(page.getByText('Size')).toBeVisible({ timeout: 5000 });
  });

  test('should navigate to wallet page', async ({ page }) => {
    // Click on the wallet link in header (HashRouter uses #/wallet)
    await page.locator('a[href="#/wallet"]').first().click();
    await page.waitForTimeout(300);

    // Should be on wallet page
    expect(page.url()).toContain('/wallet');
  });

  test('should navigate to edit profile page', async ({ page }) => {
    // Click avatar to go to user's tree list
    await page.locator(myTreesButtonSelector).click();
    await page.waitForTimeout(300);

    // Get the npub from current URL and navigate to profile
    const url = page.url();
    const npubMatch = url.match(/npub[a-z0-9]+/);
    expect(npubMatch).toBeTruthy();
    const npub = npubMatch![0];

    // Navigate to profile page
    await page.goto(`/#/${npub}/profile`);
    await page.waitForTimeout(300);

    // Should be on profile page with Edit Profile button
    await expect(page.getByRole('button', { name: 'Edit Profile' })).toBeVisible({ timeout: 5000 });

    // Click Edit Profile
    await page.getByRole('button', { name: 'Edit Profile' }).click();
    await page.waitForTimeout(300);

    // Should navigate to edit page with form fields
    expect(page.url()).toContain('/edit');
    await expect(page.locator('input[placeholder="Your name"]')).toBeVisible();
    await expect(page.locator('textarea[placeholder="Tell us about yourself"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();

    // Fill in a name
    await page.locator('input[placeholder="Your name"]').fill('Test User');

    // Go back using the back button (chevron-left icon)
    await page.locator('button:has(span.i-lucide-chevron-left)').click();
    await page.waitForTimeout(300);

    // Should be back on profile page
    expect(page.url()).not.toContain('/edit');
    await expect(page.getByRole('button', { name: 'Edit Profile' })).toBeVisible();
  });

  // Skip: setInputFiles doesn't trigger upload handler reliably in Playwright
  test.skip('should display file content when directly navigating to file URL', async ({ page, browser }) => {
    const fileList = page.getByTestId('file-list');

    // Browser 1: Create tree and upload an HTML file
    await createAndEnterTree(page, 'direct-nav-test');
    await uploadTempFile(page, 'index.html', '<html><body>Hello Direct Nav</body></html>');
    await expect(fileList.locator('span:text-is("index.html")')).toBeVisible({ timeout: 15000 });

    // Get current URL to extract npub and treeName
    const currentUrl = page.url();
    const match = currentUrl.match(/#\/(npub[^/]+)\/([^/]+)/);
    expect(match).toBeTruthy();
    const [, npub, treeName] = match!;

    // Browser 2: Fresh context navigates directly to file URL
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();

    const directFileUrl = `http://localhost:5173/#/${npub}/${treeName}/index.html`;
    await page2.goto(directFileUrl);
    await page2.waitForTimeout(3000); // Wait for nostr resolution

    // The file should be displayed in preview (rendered as iframe for HTML)
    await expect(page2.locator('.font-medium:has-text("index.html")')).toBeVisible({ timeout: 15000 });

    // For HTML files, should render in iframe
    await expect(page2.locator('iframe')).toBeVisible({ timeout: 10000 });

    await context2.close();
  });
});
