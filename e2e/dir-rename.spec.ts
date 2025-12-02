import { test, expect } from '@playwright/test';

test.describe('Directory rename', () => {
  test('should rename a subdirectory', async ({ page }) => {
    await page.goto('/');

    // Wait for the app to load and find New Folder button
    await page.waitForSelector('text=New Folder', { timeout: 10000 });

    // Click New Folder to create a root tree
    await page.click('text=New Folder');

    // Enter folder name in modal
    const input = page.locator('input[placeholder="Folder name..."]');
    await input.waitFor({ timeout: 5000 });
    await input.fill('test-rename-root');
    await page.click('button:has-text("Create")');

    // Wait for modal to close
    await expect(page.locator('.fixed.inset-0.bg-black')).not.toBeVisible({ timeout: 10000 });

    // Wait for navigation to tree view - should show empty directory
    await expect(page.locator('text=Empty directory')).toBeVisible({ timeout: 10000 });

    // Create a subdirectory - use visible button with folder-plus icon
    await page.click('button:has(.i-lucide-folder-plus):visible');

    // Enter subdirectory name
    const subInput = page.locator('input[placeholder="Folder name..."]');
    await subInput.waitFor({ timeout: 5000 });
    await subInput.fill('old-folder-name');
    await page.click('button:has-text("Create")');

    // Wait for modal to close
    await expect(page.locator('.fixed.inset-0.bg-black')).not.toBeVisible({ timeout: 10000 });

    // Wait for the subdirectory to appear in the file list
    await expect(page.locator('[data-testid="file-list"] >> text=old-folder-name')).toBeVisible({ timeout: 10000 });

    // Navigate into the subdirectory by clicking on it
    await page.click('[data-testid="file-list"] >> text=old-folder-name');

    // Wait for navigation - should see empty directory again
    await expect(page.locator('text=Empty directory')).toBeVisible({ timeout: 10000 });

    // URL should now include the folder name
    await expect(page).toHaveURL(/old-folder-name/);

    // Find and click the Rename button (should be visible for subdirectories)
    await page.click('button:has-text("Rename"):visible');

    // Wait for rename modal to appear with pre-filled input
    const renameInput = page.locator('input[placeholder="New name..."]');
    await renameInput.waitFor({ timeout: 5000 });

    // Verify the input is pre-filled with the current name
    await expect(renameInput).toHaveValue('old-folder-name');

    // Clear and enter new name
    await renameInput.fill('new-folder-name');
    // Click the Rename button inside the modal (btn-success class)
    await page.click('.fixed.inset-0 button.btn-success:has-text("Rename")');

    // Wait for modal to close
    await expect(page.locator('.fixed.inset-0.bg-black')).not.toBeVisible({ timeout: 10000 });

    // URL should now include the new folder name
    await expect(page).toHaveURL(/new-folder-name/);
    expect(page.url()).not.toContain('old-folder-name');
  });

  test('should not show rename button for root directory', async ({ page }) => {
    await page.goto('/');

    // Wait for the app to load and find New Folder button
    await page.waitForSelector('text=New Folder', { timeout: 10000 });

    // Click New Folder to create a root tree
    await page.click('text=New Folder');

    // Enter folder name in modal
    const input = page.locator('input[placeholder="Folder name..."]');
    await input.waitFor({ timeout: 5000 });
    await input.fill('test-root-no-rename');
    await page.click('button:has-text("Create")');

    // Wait for modal to close
    await expect(page.locator('.fixed.inset-0.bg-black')).not.toBeVisible({ timeout: 10000 });

    // Wait for navigation to tree view
    await expect(page.locator('text=Empty directory')).toBeVisible({ timeout: 10000 });

    // Should NOT see a Rename button for root directory
    // The "Folder" button should exist (for creating subfolders) but not Rename
    await expect(page.locator('button:has(.i-lucide-folder-plus):visible')).toBeVisible();
    await expect(page.locator('button:has-text("Rename")')).not.toBeVisible();
  });

  test('should delete a subdirectory', async ({ page }) => {
    await page.goto('/');

    // Wait for the app to load
    await page.waitForSelector('text=New Folder', { timeout: 10000 });

    // Create root tree
    await page.click('text=New Folder');
    const input = page.locator('input[placeholder="Folder name..."]');
    await input.waitFor({ timeout: 5000 });
    await input.fill('test-delete-root');
    await page.click('button:has-text("Create")');
    await expect(page.locator('.fixed.inset-0.bg-black')).not.toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Empty directory')).toBeVisible({ timeout: 10000 });

    // Create a subdirectory - use visible button with folder-plus icon
    await page.click('button:has(.i-lucide-folder-plus):visible');
    const subInput = page.locator('input[placeholder="Folder name..."]');
    await subInput.waitFor({ timeout: 5000 });
    await subInput.fill('folder-to-delete');
    await page.click('button:has-text("Create")');
    await expect(page.locator('.fixed.inset-0.bg-black')).not.toBeVisible({ timeout: 10000 });

    // Wait for and navigate into the subdirectory
    await expect(page.locator('[data-testid="file-list"] >> text=folder-to-delete')).toBeVisible({ timeout: 10000 });
    await page.click('[data-testid="file-list"] >> text=folder-to-delete');
    await expect(page.locator('text=Empty directory')).toBeVisible({ timeout: 10000 });

    // Set up dialog handler for the confirmation prompt
    page.on('dialog', async (dialog) => {
      expect(dialog.message()).toContain('Delete folder');
      await dialog.accept();
    });

    // Click Delete button
    await page.click('button:has-text("Delete"):visible');

    // Should navigate back to parent and folder should be gone
    await expect(page.locator('text=Empty directory')).toBeVisible({ timeout: 10000 });

    // URL should no longer include the deleted folder name
    expect(page.url()).not.toContain('folder-to-delete');
  });
});
