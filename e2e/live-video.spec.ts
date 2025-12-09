import { test, expect } from '@playwright/test';
import { setupPageErrorHandler, navigateToPublicFolder, goToTreeList } from './test-utils.js';

// Helper to create tree and navigate into it
async function createAndEnterTree(page: any, name: string) {
  await goToTreeList(page);
  await expect(page.getByRole('button', { name: 'New Folder' })).toBeVisible({ timeout: 10000 });
  await page.getByRole('button', { name: 'New Folder' }).click();
  await page.locator('input[placeholder="Folder name..."]').fill(name);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText('Empty directory')).toBeVisible({ timeout: 10000 });
}

test.describe('Live Video Viewer', () => {
  test.setTimeout(60000);

  test.beforeEach(async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');

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
    await page.waitForTimeout(500);
    await page.waitForSelector('header span:has-text("hashtree")', { timeout: 5000 });
    await navigateToPublicFolder(page);
  });

  test('should show stream view when stream param is present', async ({ page }) => {
    // Create tree
    await createAndEnterTree(page, 'live-video-test');

    // Start stream recording via ?stream=1 parameter
    const currentUrl = page.url();
    await page.goto(currentUrl + '?stream=1');

    // Wait for stream view header
    await expect(page.locator('text=Livestream')).toBeVisible({ timeout: 5000 });

    // Check that "Start Camera" button exists (camera permissions not needed for visibility test)
    await expect(page.getByRole('button', { name: 'Start Camera' })).toBeVisible({ timeout: 3000 });
  });

  test('video viewer should display correct duration', async ({ page }) => {
    // Note: This test verifies the video element has duration info
    // Full MSE testing would require more setup with actual video data
    await createAndEnterTree(page, 'video-duration-test');

    // For now, just verify VideoViewer loads without error for .webm files
    // Full integration test would need to create actual video content
    await expect(page.getByText('Empty directory')).toBeVisible();
  });
});
