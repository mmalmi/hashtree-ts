import { test, expect } from '@playwright/test';
import { setupPageErrorHandler, navigateToPublicFolder, goToTreeList, disableOthersPool } from './test-utils.js';

// Helper to create tree and navigate into it
async function createAndEnterTree(page: any, name: string) {
  await goToTreeList(page);
  await expect(page.getByRole('button', { name: 'New Folder' })).toBeVisible({ timeout: 10000 });
  await page.getByRole('button', { name: 'New Folder' }).click();
  await page.locator('input[placeholder="Folder name..."]').fill(name);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText('Empty directory')).toBeVisible({ timeout: 10000 });
}

// Helper to create a file and return to parent folder
async function createFile(page: any, name: string, content: string = '', treeName: string = '') {
  await page.getByRole('button', { name: /File/ }).first().click();
  await page.locator('input[placeholder="File name..."]').fill(name);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('button', { name: 'Done' })).toBeVisible({ timeout: 5000 });
  if (content) {
    await page.locator('textarea').fill(content);
    await page.getByRole('button', { name: 'Save' }).click();
    await page.waitForTimeout(500);
  }
  await page.getByRole('button', { name: 'Done' }).click();
  await page.waitForTimeout(500);

  // Navigate back to the tree folder after file creation
  if (treeName) {
    await page.locator(`a:has-text("${treeName}")`).first().click();
    await page.waitForTimeout(500);
  }
}

test.describe('Keyboard Navigation', () => {
  test.setTimeout(60000);

  test.beforeEach(async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await disableOthersPool(page); // Prevent WebRTC cross-talk from parallel tests

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
    await disableOthersPool(page); // Re-apply after reload
    await page.waitForTimeout(500);
    await page.waitForSelector('header span:has-text("Iris")', { timeout: 5000 });
    await navigateToPublicFolder(page);
  });

  test('should navigate between files with arrow keys', async ({ page }) => {
    // Create tree with multiple files
    await createAndEnterTree(page, 'keyboard-test');
    await createFile(page, 'file1.txt', 'Content 1', 'keyboard-test');
    await createFile(page, 'file2.txt', 'Content 2', 'keyboard-test');
    await createFile(page, 'file3.txt', 'Content 3', 'keyboard-test');

    // Focus the file list
    const fileList = page.getByTestId('file-list');
    await fileList.focus();

    // Press down arrow to navigate to first file
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(300);

    // Continue navigating down to file1
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(300);

    // Should select file1.txt (first file after '..' and '.')
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(500);

    // Check that file1.txt is now displayed in the viewer
    await expect(page.locator('pre')).toContainText('Content 1', { timeout: 5000 });

    // Navigate to next file
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(500);

    // Should now show file2.txt
    await expect(page.locator('pre')).toContainText('Content 2', { timeout: 5000 });
  });

  test('should navigate with vim keys (j/k)', async ({ page }) => {
    await createAndEnterTree(page, 'vim-keys-test');
    await createFile(page, 'alpha.txt', 'Alpha content', 'vim-keys-test');
    await createFile(page, 'beta.txt', 'Beta content', 'vim-keys-test');

    const fileList = page.getByTestId('file-list');
    await fileList.focus();

    // Navigate down with j key past '..' and '.' rows
    await page.keyboard.press('j'); // Focus '..'
    await page.waitForTimeout(200);
    await page.keyboard.press('j'); // Focus '.'
    await page.waitForTimeout(200);
    await page.keyboard.press('j'); // Select alpha.txt
    await page.waitForTimeout(500);

    await expect(page.locator('pre')).toContainText('Alpha content', { timeout: 5000 });

    // Navigate down with j to next file
    await page.keyboard.press('j');
    await page.waitForTimeout(500);

    await expect(page.locator('pre')).toContainText('Beta content', { timeout: 5000 });

    // Navigate back up with k
    await page.keyboard.press('k');
    await page.waitForTimeout(500);

    await expect(page.locator('pre')).toContainText('Alpha content', { timeout: 5000 });
  });

  test('should navigate into directories with Enter key', async ({ page }) => {
    await createAndEnterTree(page, 'enter-nav-test');

    // Create a subdirectory
    await page.getByRole('button', { name: /Folder/ }).first().click();
    await page.locator('input[placeholder="Folder name..."]').fill('subdir');
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(1000);

    // Navigate back to parent
    await page.locator('a:has-text("enter-nav-test")').first().click();
    await page.waitForTimeout(500);

    const fileList = page.getByTestId('file-list');
    await fileList.focus();

    // Navigate to subdir (past '..' and '.')
    await page.keyboard.press('ArrowDown'); // '..'
    await page.keyboard.press('ArrowDown'); // '.'
    await page.keyboard.press('ArrowDown'); // 'subdir'
    await page.waitForTimeout(300);

    // Press Enter to navigate into directory
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    // Should now be in subdir - verify by checking URL or empty directory message
    await expect(page.getByText(/Drop or click to add|Empty directory/).first()).toBeVisible({ timeout: 5000 });
  });

  test('should show focus ring on focused item', async ({ page }) => {
    await createAndEnterTree(page, 'focus-ring-test');
    await createFile(page, 'test.txt', 'Test content', 'focus-ring-test');

    const fileList = page.getByTestId('file-list');
    await fileList.focus();

    // Navigate down to focus '..'
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(200);

    // Check that '..' row has focus ring class
    const parentRow = page.locator('a:has-text("..")');
    await expect(parentRow).toHaveClass(/ring-accent/);
  });

  test('should navigate tree list with arrow keys', async ({ page }) => {
    // Create multiple trees
    await goToTreeList(page);
    await expect(page.getByRole('button', { name: 'New Folder' })).toBeVisible({ timeout: 10000 });

    // Create first tree
    await page.getByRole('button', { name: 'New Folder' }).click();
    await page.locator('input[placeholder="Folder name..."]').fill('tree-a');
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(500);

    // Go back and create second tree
    await page.locator('a:has-text("..")').first().click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'New Folder' }).click();
    await page.locator('input[placeholder="Folder name..."]').fill('tree-b');
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(500);

    // Go back to tree list
    await page.locator('a:has-text("..")').first().click();
    await page.waitForTimeout(500);

    // Use first() since profile page may have multiple file-list elements
    const fileList = page.getByTestId('file-list').first();
    await fileList.focus();

    // Navigate down to first non-default tree (after public, link, private)
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(200);

    // Check focus ring is visible on a tree item
    const focusedTree = page.locator('[data-testid="file-list"] a.ring-accent');
    await expect(focusedTree).toBeVisible({ timeout: 2000 });
  });
});
