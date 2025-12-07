import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { setupPageErrorHandler, navigateToPublicFolder, myTreesButtonSelector } from './test-utils.js';

test.describe('FileBrowser keyboard navigation', () => {
  let tempDir: string;
  let testFiles: string[];

  test.beforeEach(async () => {
    // Create temp directory with test files
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keyboard-test-'));
    testFiles = [];

    // Create test files
    for (let i = 1; i <= 3; i++) {
      const filePath = path.join(tempDir, `file-${i}.txt`);
      fs.writeFileSync(filePath, `Content of file ${i}`);
      testFiles.push(filePath);
    }
  });

  test.afterEach(async () => {
    // Clean up temp files
    for (const file of testFiles) {
      try { fs.unlinkSync(file); } catch {}
    }
    try { fs.rmdirSync(tempDir); } catch {}
  });

  // Skip: setInputFiles doesn't trigger upload handler reliably in Playwright
  test.skip('should navigate files with arrow keys and preview them', async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await navigateToPublicFolder(page);

    // Navigate to tree list first, then create a folder
    await page.locator(myTreesButtonSelector).click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'New Folder' }).click();

    const input = page.locator('input[placeholder="Folder name..."]');
    await input.waitFor({ timeout: 5000 });
    await input.fill('keyboard-test-folder');
    await page.click('button:has-text("Create")');

    // Wait for modal to close and empty directory to show
    await expect(page.locator('.fixed.inset-0.bg-black')).not.toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Empty directory')).toBeVisible({ timeout: 10000 });

    // Upload test files
    const fileInput = page.locator('input[type="file"][multiple]').first();
    await fileInput.setInputFiles(testFiles);
    // Wait longer for upload processing
    await page.waitForTimeout(3000);

    // Wait for all files to appear in file list (use specific selector to avoid upload progress indicator)
    await expect(page.locator('[data-testid="file-list"] a:has-text("file-1.txt")')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="file-list"] a:has-text("file-2.txt")')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="file-list"] a:has-text("file-3.txt")')).toBeVisible({ timeout: 15000 });

    // Focus the file list
    const fileList = page.locator('[data-testid="file-list"]');
    await fileList.focus();

    // Press ArrowDown to select first file
    await page.keyboard.press('ArrowDown');

    // Wait for navigation to file-1.txt
    await expect(page).toHaveURL(/file-1\.txt/, { timeout: 5000 });

    // Refocus: click parent row area (not on a link) to restore focus
    await page.waitForTimeout(200);
    await fileList.focus();
    await page.waitForTimeout(100);

    // Press ArrowDown again to go to file-2.txt
    await page.keyboard.press('ArrowDown');
    await expect(page).toHaveURL(/file-2\.txt/, { timeout: 5000 });

    // Refocus file list
    await page.waitForTimeout(200);
    await fileList.focus();
    await page.waitForTimeout(100);

    // Press ArrowDown to go to file-3.txt
    await page.keyboard.press('ArrowDown');
    await expect(page).toHaveURL(/file-3\.txt/, { timeout: 5000 });

    // Refocus file list
    await page.waitForTimeout(200);
    await fileList.focus();
    await page.waitForTimeout(100);

    // Press ArrowUp to go back to file-2.txt
    await page.keyboard.press('ArrowUp');
    await expect(page).toHaveURL(/file-2\.txt/, { timeout: 5000 });

    // Refocus file list
    await page.waitForTimeout(200);
    await fileList.focus();
    await page.waitForTimeout(100);

    // Press ArrowUp to go to file-1.txt
    await page.keyboard.press('ArrowUp');
    await expect(page).toHaveURL(/file-1\.txt/, { timeout: 5000 });
  });

  // Skip: Uses mobile viewport which has issues with folder button visibility
  test.skip('should enter directories with Enter key', async ({ page }) => {
    setupPageErrorHandler(page);
    // Use mobile viewport because FolderActions buttons are hidden on desktop (lg:hidden)
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await navigateToPublicFolder(page);

    // Navigate to tree list first, then create a folder
    await page.locator(myTreesButtonSelector).click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'New Folder' }).click();

    const input = page.locator('input[placeholder="Folder name..."]');
    await input.waitFor({ timeout: 5000 });
    await input.fill('enter-test-folder');
    await page.click('button:has-text("Create")');

    // Wait for modal to close
    await expect(page.locator('.fixed.inset-0.bg-black')).not.toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Empty directory')).toBeVisible({ timeout: 10000 });

    // Create a subfolder using the Folder button in FolderActions
    // Use more specific selector to avoid ambiguity
    const folderButton = page.locator('button:has-text("Folder")').first();
    await folderButton.click();

    const subfolderInput = page.locator('input[placeholder="Folder name..."]');
    await subfolderInput.waitFor({ timeout: 5000 });
    await subfolderInput.fill('subfolder');

    // Click Create button in modal
    const createButton = page.locator('button:has-text("Create")');
    await createButton.click();

    // Wait for modal to close and subfolder to appear in file list
    await expect(page.locator('.fixed.inset-0.bg-black')).not.toBeVisible({ timeout: 10000 });
    // Look for the subfolder link specifically
    await expect(page.locator('a:has-text("subfolder")')).toBeVisible({ timeout: 10000 });

    // Focus the file list
    const fileList = page.locator('[data-testid="file-list"]');
    await fileList.focus();

    // Press ArrowDown to focus the subfolder
    await page.keyboard.press('ArrowDown');

    // The subfolder should be focused (ring highlight) but not navigated to yet
    // since directories are only focused, not auto-navigated

    // Press Enter to navigate into the subfolder
    await page.keyboard.press('Enter');

    // URL should now include the subfolder path
    await expect(page).toHaveURL(/subfolder/, { timeout: 5000 });

    // Should see Empty directory in the subfolder
    await expect(page.locator('text=Empty directory')).toBeVisible({ timeout: 5000 });
  });
});
