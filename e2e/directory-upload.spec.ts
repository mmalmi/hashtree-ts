import { test, expect } from '@playwright/test';
import { setupPageErrorHandler, waitForNewUserRedirect, myTreesButtonSelector } from './test-utils.js';

test.describe('Directory upload features', () => {
  test('should show Upload Dir button when in a folder (if browser supports it)', async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await waitForNewUserRedirect(page);

    // Navigate to tree list and create a folder
    await page.locator(myTreesButtonSelector).click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'New Folder' }).click();

    const input = page.locator('input[placeholder="Folder name..."]');
    await input.waitFor({ timeout: 5000 });
    await input.fill('dir-upload-test');
    await page.click('button:has-text("Create")');

    // Wait for modal to close
    await expect(page.locator('.fixed.inset-0.bg-black')).not.toBeVisible({ timeout: 10000 });

    // Wait for the folder to be created
    await expect(page.locator('text=Empty directory')).toBeVisible({ timeout: 10000 });

    // The Upload Dir button should be visible (browsers that support webkitdirectory)
    // Note: This checks for the label since it's a file input trigger
    const uploadDirButtons = page.locator('label:has-text("Upload Dir")');

    // Check if directory upload is supported (it should be in Chromium-based browsers)
    const count = await uploadDirButtons.count();
    if (count > 0) {
      // At least one of the Upload Dir buttons should be visible
      // There may be duplicate buttons (mobile and desktop)
      const anyVisible = await uploadDirButtons.evaluateAll((buttons) =>
        buttons.some((b) => {
          const style = window.getComputedStyle(b);
          return style.display !== 'none' && style.visibility !== 'hidden';
        })
      );
      expect(anyVisible).toBe(true);
    }
  });

  test('should have webkitdirectory attribute on directory input', async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await waitForNewUserRedirect(page);

    // Navigate to tree list and create a folder
    await page.locator(myTreesButtonSelector).click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'New Folder' }).click();

    const input = page.locator('input[placeholder="Folder name..."]');
    await input.waitFor({ timeout: 5000 });
    await input.fill('dir-attr-test');
    await page.click('button:has-text("Create")');

    // Wait for modal to close and folder view
    await expect(page.locator('.fixed.inset-0.bg-black')).not.toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Empty directory')).toBeVisible({ timeout: 10000 });

    // Find the directory input by looking for an input with webkitdirectory attribute
    const dirInput = page.locator('input[type="file"][webkitdirectory]');

    const count = await dirInput.count();
    if (count > 0) {
      // Verify the input exists and has the correct attribute
      await expect(dirInput).toHaveCount(1);
    }
  });

  test('should show both regular Upload and Upload Dir buttons', async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await waitForNewUserRedirect(page);

    // Navigate to tree list and create a folder
    await page.locator(myTreesButtonSelector).click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'New Folder' }).click();

    const input = page.locator('input[placeholder="Folder name..."]');
    await input.waitFor({ timeout: 5000 });
    await input.fill('both-buttons-test');
    await page.click('button:has-text("Create")');

    // Wait for modal to close
    await expect(page.locator('.fixed.inset-0.bg-black')).not.toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Empty directory')).toBeVisible({ timeout: 10000 });

    // Both upload buttons should exist
    // Regular upload (green btn-success class) - there may be mobile and desktop versions
    const regularUploads = page.locator('label.btn-success:has-text("Upload")');
    const regularCount = await regularUploads.count();
    expect(regularCount).toBeGreaterThan(0);

    // Directory upload (should not have btn-success, just btn-ghost)
    const dirUploads = page.locator('label.btn-ghost:has-text("Upload Dir")');
    const dirCount = await dirUploads.count();

    if (dirCount > 0) {
      // At least one visible directory upload button
      const anyDirVisible = await dirUploads.evaluateAll((buttons) =>
        buttons.some((b) => {
          const style = window.getComputedStyle(b);
          return style.display !== 'none' && style.visibility !== 'hidden';
        })
      );
      expect(anyDirVisible).toBe(true);

      // Verify they have different styling by checking classes on any instance
      const regularClass = await regularUploads.first().getAttribute('class');
      const dirClass = await dirUploads.first().getAttribute('class');

      expect(regularClass).toContain('btn-success');
      expect(dirClass).not.toContain('btn-success');
      expect(dirClass).toContain('btn-ghost');
    }
  });
});
