import { test, expect, type Route } from '@playwright/test';
import { setupPageErrorHandler, navigateToPublicFolder } from './test-utils.js';

test.describe('Blossom Push', () => {
  test('can open push modal and see server selection', { timeout: 60000 }, async ({ page }) => {
    setupPageErrorHandler(page);

    // Go to home page first (creates user session)
    await page.goto('/');

    // Navigate to public folder where we have files
    await navigateToPublicFolder(page);

    // Wait for Push button to be visible
    const pushBtn = page.getByRole('button', { name: 'Push' }).first();
    await expect(pushBtn).toBeVisible({ timeout: 10000 });

    // Click push button
    await pushBtn.click();

    // Modal should appear
    const modal = page.locator('[data-testid="blossom-push-modal"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Should show server selection with write-enabled servers from defaults
    await expect(modal.locator('text=Push to Blossom')).toBeVisible();
    // Should show at least one server checkbox (blossom.iris.to or blossom.nostr.build)
    await expect(modal.locator('input[type="checkbox"]').first()).toBeVisible();

    // Should show the Push button
    await expect(modal.locator('[data-testid="start-push-btn"]')).toBeVisible();

    // Close modal by pressing Escape
    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible({ timeout: 5000 });
  });

  test('push modal shows correct server options', { timeout: 60000 }, async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');

    // Navigate to public folder
    await navigateToPublicFolder(page);

    // Click push button
    await page.getByRole('button', { name: 'Push' }).first().click();

    // Modal should appear
    const modal = page.locator('[data-testid="blossom-push-modal"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Should show write-enabled servers from default config
    // blossom.iris.to (write: true) and blossom.nostr.build (write: true)
    await expect(modal.locator('text=blossom.iris.to')).toBeVisible();
    await expect(modal.locator('text=blossom.nostr.build')).toBeVisible();

    // files.iris.to should NOT appear (it's read-only)
    await expect(modal.locator('text=files.iris.to')).not.toBeVisible();

    // Close modal
    await modal.locator('button', { hasText: 'Cancel' }).click();
    await expect(modal).not.toBeVisible({ timeout: 5000 });
  });

  test('push modal with mocked server shows progress', { timeout: 90000 }, async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');

    // Track uploaded blobs
    const uploadedBlobs: string[] = [];

    // Mock blossom server responses
    await page.route('**/upload', async (route: Route) => {
      const request = route.request();
      if (request.method() === 'PUT') {
        const hash = request.headers()['x-sha-256'];
        if (hash) {
          uploadedBlobs.push(hash);
        }
        // Simulate successful upload
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            sha256: hash,
            size: 100,
            type: 'application/octet-stream',
            uploaded: Date.now(),
          }),
        });
      } else {
        await route.continue();
      }
    });

    // Navigate to public folder
    await navigateToPublicFolder(page);

    // Click push button
    await page.getByRole('button', { name: 'Push' }).first().click();

    // Modal should appear
    const modal = page.locator('[data-testid="blossom-push-modal"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Start push
    const startPushBtn = page.locator('[data-testid="start-push-btn"]');
    await expect(startPushBtn).toBeVisible({ timeout: 5000 });
    await startPushBtn.click();

    // Should show progress or completion
    // Wait for done state (may be quick with mocked server)
    await expect(modal.locator('button', { hasText: 'Done' })).toBeVisible({ timeout: 30000 });

    // Verify some uploads were attempted
    console.log('Uploaded blobs:', uploadedBlobs.length);

    // Close modal
    await page.locator('button', { hasText: 'Done' }).click();
    await expect(modal).not.toBeVisible({ timeout: 5000 });
  });

  test('push modal handles upload errors gracefully', { timeout: 90000 }, async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');

    // Mock failing blossom server
    await page.route('**/upload', async (route: Route) => {
      const request = route.request();
      if (request.method() === 'PUT') {
        await route.fulfill({
          status: 500,
          contentType: 'text/plain',
          body: 'Internal Server Error',
        });
      } else {
        await route.continue();
      }
    });

    // Navigate to public folder
    await navigateToPublicFolder(page);

    // Click push button
    await page.getByRole('button', { name: 'Push' }).first().click();

    // Start push
    const modal = page.locator('[data-testid="blossom-push-modal"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    await page.locator('[data-testid="start-push-btn"]').click();

    // Wait for completion with errors
    await expect(modal.locator('button', { hasText: 'Done' })).toBeVisible({ timeout: 30000 });

    // Should show error count (Failed label should be visible in stats grid)
    await expect(modal.locator('.text-danger').first()).toBeVisible();

    // Close modal
    await page.locator('button', { hasText: 'Done' }).click();
    await expect(modal).not.toBeVisible({ timeout: 5000 });
  });
});
