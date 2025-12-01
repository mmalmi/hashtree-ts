import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

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

  test('should upload multiple files at once', async ({ page }) => {
    await page.goto('/');

    // Wait for the app to load and find New Folder button
    await page.waitForSelector('text=New Folder', { timeout: 10000 });

    // Click New Folder to create a folder/tree
    await page.click('text=New Folder');

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

    // Wait for all files to appear in the file browser (use more specific selector to avoid upload progress indicator)
    await expect(page.locator('[data-testid="file-list"] a:has-text("test-file-1.txt")')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="file-list"] a:has-text("test-file-2.txt")')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="file-list"] a:has-text("test-file-3.txt")')).toBeVisible({ timeout: 10000 });
  });

  test('should not navigate to any file after multi-file upload', async ({ page }) => {
    await page.goto('/');

    // Wait for the app to load and find New Folder button
    await page.waitForSelector('text=New Folder', { timeout: 10000 });

    // Click New Folder to create a folder/tree
    await page.click('text=New Folder');

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
