import { test, expect } from '@playwright/test';
import { setupPageErrorHandler, navigateToPublicFolder } from './test-utils.js';

test.describe('Compression features', () => {
  test('should show ZIP button when viewing a folder', async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await navigateToPublicFolder(page);

    // Navigate to tree list and create a folder
    await page.locator('header a:has-text("hashtree")').click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'New Folder' }).click();

    const input = page.locator('input[placeholder="Folder name..."]');
    await input.waitFor({ timeout: 5000 });
    await input.fill('zip-test-folder');
    await page.click('button:has-text("Create")');

    // Wait for modal to close
    await expect(page.locator('.fixed.inset-0.bg-black')).not.toBeVisible({ timeout: 10000 });

    // Wait for the folder to be created (should show empty directory)
    await expect(page.locator('text=Empty directory')).toBeVisible({ timeout: 10000 });

    // The ZIP button should be visible in the folder actions (use getByRole for more reliable selection)
    const zipButton = page.getByRole('button', { name: 'ZIP' });
    await expect(zipButton).toBeVisible({ timeout: 5000 });

    // The button should say "ZIP"
    await expect(zipButton).toHaveText(/ZIP/);
  });

  test('should show ZIP button with proper icon', async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await navigateToPublicFolder(page);

    // Navigate to tree list and create a folder
    await page.locator('header a:has-text("hashtree")').click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'New Folder' }).click();

    const input = page.locator('input[placeholder="Folder name..."]');
    await input.waitFor({ timeout: 5000 });
    await input.fill('zip-icon-test');
    await page.click('button:has-text("Create")');

    // Wait for modal to close
    await expect(page.locator('.fixed.inset-0.bg-black')).not.toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Empty directory')).toBeVisible({ timeout: 10000 });

    // Check that the ZIP button exists and contains the archive icon
    const zipButton = page.getByRole('button', { name: 'ZIP' });
    await expect(zipButton).toBeVisible({ timeout: 5000 });

    // The button should contain an icon with the archive class
    const icon = zipButton.locator('span.i-lucide-archive');
    await expect(icon).toBeVisible({ timeout: 2000 });
  });

  test('should show Permalink, Fork, and ZIP buttons for folder', async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await navigateToPublicFolder(page);

    // Navigate to tree list and create a folder
    await page.locator('header a:has-text("hashtree")').click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'New Folder' }).click();

    const input = page.locator('input[placeholder="Folder name..."]');
    await input.waitFor({ timeout: 5000 });
    await input.fill('actions-test-folder');
    await page.click('button:has-text("Create")');

    // Wait for modal to close
    await expect(page.locator('.fixed.inset-0.bg-black')).not.toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Empty directory')).toBeVisible({ timeout: 10000 });

    // All three folder action buttons should be visible (use getByRole for reliable selection)
    await expect(page.getByRole('link', { name: 'Permalink' })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: 'Fork' })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: 'ZIP' })).toBeVisible({ timeout: 5000 });
  });
});
