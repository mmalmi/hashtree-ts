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

  test('should fork a folder as a new top-level tree', async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await navigateToPublicFolder(page);

    // Create a top-level folder first
    await page.locator('header a:has-text("hashtree")').click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'New Folder' }).click();

    const input = page.locator('input[placeholder="Folder name..."]');
    await input.waitFor({ timeout: 5000 });
    await input.fill('fork-source');
    await page.click('button:has-text("Create")');

    // Wait for modal to close and navigate to the new folder
    await expect(page.locator('.fixed.inset-0.bg-black')).not.toBeVisible({ timeout: 10000 });
    // Wait for URL to contain fork-source
    await expect(page).toHaveURL(/fork-source/, { timeout: 10000 });

    // Click the Fork button (the one in folder actions)
    await page.getByRole('button', { name: 'Fork' }).click();

    // Fork modal should appear
    await expect(page.locator('text="Fork as New Folder"')).toBeVisible({ timeout: 5000 });
    const forkInput = page.locator('input#fork-name');
    await expect(forkInput).toBeVisible();

    // Change the name and fork using the modal's Fork button
    await forkInput.fill('my-forked-folder');
    // Click the Fork button in the modal (use locator inside modal)
    await page.locator('.fixed.inset-0').getByRole('button', { name: 'Fork' }).click();

    // Wait for modal to close and navigation to the new folder
    await expect(page.locator('text="Fork as New Folder"')).not.toBeVisible({ timeout: 10000 });

    // Should be navigated to the new forked folder
    await expect(page).toHaveURL(/my-forked-folder/, { timeout: 10000 });

    // Navigate back to tree list and verify the forked folder exists as top-level
    await page.locator('header a:has-text("hashtree")').click();
    await page.waitForTimeout(500);

    // my-forked-folder should appear in the tree list
    await expect(page.getByTestId('file-list').locator('a:has-text("my-forked-folder")')).toBeVisible({ timeout: 5000 });
  });

  test('should fork a folder with visibility selection', async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await navigateToPublicFolder(page);

    // Create a top-level folder first
    await page.locator('header a:has-text("hashtree")').click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'New Folder' }).click();

    const input = page.locator('input[placeholder="Folder name..."]');
    await input.waitFor({ timeout: 5000 });
    await input.fill('fork-visibility-source');
    await page.click('button:has-text("Create")');

    // Wait for modal to close and navigate to the new folder
    await expect(page.locator('.fixed.inset-0.bg-black')).not.toBeVisible({ timeout: 10000 });
    await expect(page).toHaveURL(/fork-visibility-source/, { timeout: 10000 });

    // Click the Fork button
    await page.getByRole('button', { name: 'Fork' }).click();

    // Fork modal should appear with visibility picker
    await expect(page.locator('text="Fork as New Folder"')).toBeVisible({ timeout: 5000 });
    const forkInput = page.locator('input#fork-name');
    await expect(forkInput).toBeVisible();

    // Visibility picker should be visible with all three options
    await expect(page.locator('button:has-text("public")')).toBeVisible();
    await expect(page.locator('button:has-text("unlisted")')).toBeVisible();
    await expect(page.locator('button:has-text("private")')).toBeVisible();

    // Public should be selected by default (uses ring-accent for selected state)
    const publicButton = page.locator('.fixed.inset-0').locator('button:has-text("public")');
    await expect(publicButton).toHaveClass(/ring-accent/);

    // Change the name and select unlisted visibility
    await forkInput.fill('my-unlisted-fork');
    await page.locator('.fixed.inset-0').locator('button:has-text("unlisted")').click();

    // Click Fork button
    await page.locator('.fixed.inset-0').getByRole('button', { name: 'Fork' }).click();

    // Wait for modal to close and navigation
    await expect(page.locator('text="Fork as New Folder"')).not.toBeVisible({ timeout: 10000 });

    // Should be navigated to the new forked folder (with link key for unlisted)
    await expect(page).toHaveURL(/my-unlisted-fork/, { timeout: 10000 });

    // The URL should contain a link key parameter for unlisted tree
    await expect(page).toHaveURL(/\?k=/, { timeout: 5000 });
  });

  test('should suggest unique name when forking folder with existing name', async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await navigateToPublicFolder(page);

    // Create first top-level folder
    await page.locator('header a:has-text("hashtree")').click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'New Folder' }).click();

    let input = page.locator('input[placeholder="Folder name..."]');
    await input.waitFor({ timeout: 5000 });
    await input.fill('existing-tree');
    await page.click('button:has-text("Create")');

    // Wait for modal to close and navigate to folder
    await expect(page.locator('.fixed.inset-0.bg-black')).not.toBeVisible({ timeout: 10000 });
    await expect(page).toHaveURL(/existing-tree/, { timeout: 10000 });

    // Now create a subfolder named the same
    await page.getByRole('button', { name: 'New Folder' }).click();
    input = page.locator('input[placeholder="Folder name..."]');
    await input.waitFor({ timeout: 5000 });
    await input.fill('existing-tree');
    await page.click('button:has-text("Create")');

    // Wait for modal to close
    await expect(page.locator('.fixed.inset-0.bg-black')).not.toBeVisible({ timeout: 10000 });

    // Wait for the subfolder to appear in sidebar navigation
    // It shows as a sibling link in the breadcrumb after its parent
    const subfolderLink = page.locator('a[href*="existing-tree/existing-tree"]');
    await expect(subfolderLink).toBeVisible({ timeout: 5000 });

    // Click on the subfolder to navigate into it
    await subfolderLink.click();
    // URL should now have existing-tree/existing-tree
    await expect(page).toHaveURL(/existing-tree\/existing-tree/, { timeout: 10000 });

    // Click Fork on the subfolder
    await page.getByRole('button', { name: 'Fork' }).click();

    // The suggested name should be "existing-tree-2" since "existing-tree" already exists as top-level
    const forkInput = page.locator('input#fork-name');
    await expect(forkInput).toHaveValue('existing-tree-2', { timeout: 5000 });

    // Fork with the suggested unique name
    await page.locator('.fixed.inset-0').getByRole('button', { name: 'Fork' }).click();

    // Should navigate to the new tree
    await expect(page.locator('text="Fork as New Folder"')).not.toBeVisible({ timeout: 10000 });
    await expect(page).toHaveURL(/existing-tree-2/, { timeout: 10000 });
  });
});
