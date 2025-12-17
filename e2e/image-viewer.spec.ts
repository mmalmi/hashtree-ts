import { test, expect } from '@playwright/test';
import { setupPageErrorHandler, navigateToPublicFolder, goToTreeList } from './test-utils.js';

// Helper to create tree via modal and navigate into it
async function createAndEnterTree(page: any, name: string) {
  await goToTreeList(page);
  await expect(page.getByRole('button', { name: 'New Folder' })).toBeVisible({ timeout: 10000 });
  await page.getByRole('button', { name: 'New Folder' }).click();
  await page.locator('input[placeholder="Folder name..."]').fill(name);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText('Empty directory')).toBeVisible({ timeout: 10000 });
}

// Minimal valid 1x1 red PNG as byte array
const PNG_BYTES = [
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
  0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1
  0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xDE, // RGB, no interlace, CRC
  0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, 0x54, // IDAT chunk
  0x08, 0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00, 0x00, // compressed data
  0x03, 0x00, 0x01, 0x00, 0x18, 0xDD, 0x8D, 0xB4, // CRC
  0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, // IEND
  0xAE, 0x42, 0x60, 0x82 // CRC
];

test.describe('Image Viewer', () => {
  test.setTimeout(30000);

  test.beforeEach(async ({ page }) => {
    setupPageErrorHandler(page);
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

    await page.reload();
    await page.waitForTimeout(500);
    await page.waitForSelector('header span:has-text("Iris")', { timeout: 5000 });
    await navigateToPublicFolder(page);
  });

  test('should display image file correctly (not show "Unable to display")', async ({ page }) => {
    // Create a new tree for the test
    await createAndEnterTree(page, 'image-test');

    // Wait for test helper to be available
    await page.waitForFunction(() => (window as any).__testHelpers?.uploadSingleFile, { timeout: 5000 });

    // Add image file directly via the exposed test helper
    await page.evaluate(async (pngBytes) => {
      const data = new Uint8Array(pngBytes);
      await (window as any).__testHelpers.uploadSingleFile('test-image.png', data);
    }, PNG_BYTES);

    await page.waitForTimeout(2000);

    // Wait for file to appear in file list
    const fileList = page.getByTestId('file-list');
    await expect(fileList.locator('a').filter({ hasText: 'test-image.png' }).first()).toBeVisible({ timeout: 10000 });

    // Click to view the image
    await fileList.locator('a').filter({ hasText: 'test-image.png' }).first().click();
    await page.waitForTimeout(2000);

    // Image should be visible in the viewer
    await expect(page.getByTestId('image-viewer')).toBeVisible({ timeout: 10000 });

    // The "Unable to display" message should NOT be visible
    await expect(page.getByText('Unable to display file content')).not.toBeVisible();
  });

  test('should display image with blob URL as src', async ({ page }) => {
    await createAndEnterTree(page, 'image-blob-test');

    // Wait for test helper to be available
    await page.waitForFunction(() => (window as any).__testHelpers?.uploadSingleFile, { timeout: 5000 });

    // Add image file directly via the exposed test helper
    await page.evaluate(async (pngBytes) => {
      const data = new Uint8Array(pngBytes);
      await (window as any).__testHelpers.uploadSingleFile('blob-test.png', data);
    }, PNG_BYTES);

    await page.waitForTimeout(1500);

    const fileList = page.getByTestId('file-list');
    await expect(fileList.locator('a').filter({ hasText: 'blob-test.png' }).first()).toBeVisible({ timeout: 10000 });

    await fileList.locator('a').filter({ hasText: 'blob-test.png' }).first().click();
    await page.waitForTimeout(1000);

    // Verify the image has a blob URL as src
    const img = page.getByTestId('image-viewer');
    await expect(img).toBeVisible({ timeout: 5000 });

    const src = await img.getAttribute('src');
    expect(src).toBeTruthy();
    // Blob URLs start with "blob:"
    expect(src?.startsWith('blob:')).toBe(true);
  });

  test('should not flash "Unable to display" while loading image', async ({ page }) => {
    await createAndEnterTree(page, 'no-flash-test');

    // Wait for test helper to be available
    await page.waitForFunction(() => (window as any).__testHelpers?.uploadSingleFile, { timeout: 5000 });

    // Add image file
    await page.evaluate(async (pngBytes) => {
      const data = new Uint8Array(pngBytes);
      await (window as any).__testHelpers.uploadSingleFile('noflash.png', data);
    }, PNG_BYTES);

    await page.waitForTimeout(1500);

    const fileList = page.getByTestId('file-list');
    await expect(fileList.locator('a').filter({ hasText: 'noflash.png' }).first()).toBeVisible({ timeout: 10000 });

    // Click and immediately check for error message
    await fileList.locator('a').filter({ hasText: 'noflash.png' }).first().click();

    // Wait a tiny bit for any flash to occur
    await page.waitForTimeout(100);

    // "Unable to display" should NOT be visible during loading
    const errorMsg = page.getByText('Unable to display file content');
    const isErrorVisible = await errorMsg.isVisible().catch(() => false);
    expect(isErrorVisible).toBe(false);

    // Wait for image to load
    await expect(page.getByTestId('image-viewer')).toBeVisible({ timeout: 5000 });
  });
});
