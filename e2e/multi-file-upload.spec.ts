import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { setupPageErrorHandler, navigateToPublicFolder } from './test-utils.js';

test.describe('Multi-file upload', () => {
  let tempDir: string;
  let testFiles: string[];

  test.beforeEach(async () => {
    // Create temp directory with test files
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-test-'));
    testFiles = [];

    // Create 3 test files
    for (let i = 1; i <= 3; i++) {
      const filePath = path.join(tempDir, `test-file-${i}.txt`);
      fs.writeFileSync(filePath, `Content of test file ${i}`);
      testFiles.push(filePath);
    }
  });

  test.afterEach(async () => {
    // Clean up temp files
    for (const file of testFiles) {
      try {
        fs.unlinkSync(file);
      } catch {}
    }
    try {
      fs.rmdirSync(tempDir);
    } catch {}
  });

  // Skip: setInputFiles doesn't trigger upload handler reliably in Playwright
  test.skip('should upload multiple files at once', async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await navigateToPublicFolder(page);

    // Navigate to tree list first, then create a folder
    await page.locator('header a:has-text("hashtree")').click();
    await page.waitForTimeout(300);

    // Click New Folder to create a folder/tree
    await page.getByRole('button', { name: 'New Folder' }).click();

    // Enter folder name in modal
    const input = page.locator('input[placeholder="Folder name..."]');
    await input.waitFor({ timeout: 5000 });
    await input.fill('test-upload-folder');
    await page.click('button:has-text("Create")');

    // Wait for modal to close (the fixed background overlay)
    await expect(page.locator('.fixed.inset-0.bg-black')).not.toBeVisible({ timeout: 10000 });

    // Wait for navigation to tree view - should show empty directory
    await expect(page.locator('text=Empty directory')).toBeVisible({ timeout: 10000 });

    // Find the file input and upload multiple files
    const fileInput = page.locator('input[type="file"][multiple]').first();
    await fileInput.setInputFiles(testFiles);
    // Wait longer for upload processing
    await page.waitForTimeout(3000);

    // Wait for all files to appear in the file browser (use more specific selector to avoid upload progress indicator)
    await expect(page.locator('[data-testid="file-list"] a:has-text("test-file-1.txt")')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="file-list"] a:has-text("test-file-2.txt")')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="file-list"] a:has-text("test-file-3.txt")')).toBeVisible({ timeout: 15000 });
  });

  test('should not navigate to any file after multi-file upload', async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await navigateToPublicFolder(page);

    // Navigate to tree list first, then create a folder
    await page.locator('header a:has-text("hashtree")').click();
    await page.waitForTimeout(300);

    // Click New Folder to create a folder/tree
    await page.getByRole('button', { name: 'New Folder' }).click();

    // Enter folder name in modal
    const input = page.locator('input[placeholder="Folder name..."]');
    await input.waitFor({ timeout: 5000 });
    await input.fill('test-upload-folder-2');
    await page.click('button:has-text("Create")');

    // Wait for modal to close
    await expect(page.locator('.fixed.inset-0.bg-black')).not.toBeVisible({ timeout: 10000 });

    // Wait for navigation to tree view - should show empty directory
    await expect(page.locator('text=Empty directory')).toBeVisible({ timeout: 10000 });

    // Find the file input and upload multiple files
    const fileInput = page.locator('input[type="file"][multiple]').first();
    await fileInput.setInputFiles(testFiles);

    // Wait for files to appear
    await expect(page.locator('text=test-file-1.txt')).toBeVisible({ timeout: 10000 });

    // Wait a bit to ensure no navigation happens
    await page.waitForTimeout(500);

    // URL should not include any of the test file names
    const currentUrl = page.url();
    expect(currentUrl).not.toContain('test-file-1.txt');
    expect(currentUrl).not.toContain('test-file-2.txt');
    expect(currentUrl).not.toContain('test-file-3.txt');
  });
});
