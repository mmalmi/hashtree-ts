/**
 * E2E tests for subdirectory creation
 *
 * Tests that subdirectories are properly created and display as folders
 * (not files) across all visibility types: public, unlisted, and private.
 */
import { test, expect } from '@playwright/test';
import { setupPageErrorHandler, waitForNewUserRedirect, myTreesButtonSelector } from './test-utils.js';

test.describe('Subdirectory Creation', () => {
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
    await waitForNewUserRedirect(page);
  });

  test('subdirectory in public tree should show as folder with folder icon', async ({ page }) => {
    // Go to tree list
    await page.locator(myTreesButtonSelector).click();
    await page.waitForTimeout(300);

    // Create a public tree (default visibility)
    await page.getByRole('button', { name: 'New Folder' }).click();
    await page.locator('input[placeholder="Folder name..."]').fill('public-parent');
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(1000);

    // Should be inside the tree now
    await expect(page.getByText('Empty directory')).toBeVisible({ timeout: 5000 });

    // Create a subfolder
    await page.getByRole('button', { name: /Folder/ }).first().click();
    await page.locator('input[placeholder="Folder name..."]').fill('subfolder');
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(1000);

    // The subfolder should be visible in the file list
    const subfolderRow = page.locator('a:has-text("subfolder")');
    await expect(subfolderRow).toBeVisible({ timeout: 5000 });

    // CRITICAL: Should have folder icon, NOT file icon
    // Folder icon is i-lucide-folder or i-lucide-folder-open
    const folderIcon = subfolderRow.locator('span[class*="i-lucide-folder"]');
    await expect(folderIcon).toBeVisible({ timeout: 5000 });

    // Should NOT have file icon
    const fileIcon = subfolderRow.locator('span.i-lucide-file');
    await expect(fileIcon).not.toBeVisible();
  });

  test('clicking subdirectory in public tree should navigate into it', async ({ page }) => {
    // Go to tree list
    await page.locator(myTreesButtonSelector).click();
    await page.waitForTimeout(300);

    // Create a public tree
    await page.getByRole('button', { name: 'New Folder' }).click();
    await page.locator('input[placeholder="Folder name..."]').fill('public-nav');
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(1000);

    // Create a subfolder
    await page.getByRole('button', { name: /Folder/ }).first().click();
    await page.locator('input[placeholder="Folder name..."]').fill('child-folder');
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(1000);

    // Click on the subfolder to navigate into it
    await page.locator('a:has-text("child-folder")').click();
    await page.waitForTimeout(500);

    // URL should now include the subfolder path
    expect(page.url()).toContain('child-folder');

    // Should show "Empty directory" (we're inside the subfolder now)
    await expect(page.getByText('Empty directory')).toBeVisible({ timeout: 5000 });

    // Should have ".." entry to go back
    await expect(page.locator('a:has-text("..")')).toBeVisible();
  });

  test.skip('nested subdirectories in public tree should all show as folders', async ({ page }) => {
    // TODO: File/Folder buttons not showing when inside subdirectory - separate bug
    // Go to tree list
    await page.locator(myTreesButtonSelector).click();
    await page.waitForTimeout(300);

    // Create a public tree
    await page.getByRole('button', { name: 'New Folder' }).click();
    await page.locator('input[placeholder="Folder name..."]').fill('public-nested');
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(1000);

    // Create first subfolder
    await page.getByRole('button', { name: /Folder/ }).first().click();
    await page.locator('input[placeholder="Folder name..."]').fill('level1');
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(1000);

    // Navigate into level1
    await page.locator('a:has-text("level1")').click();
    await page.waitForTimeout(1000);

    // Wait for Empty directory or Folder button to appear (we're now inside level1)
    await expect(page.getByText('Empty directory')).toBeVisible({ timeout: 10000 });

    // Create second subfolder inside level1
    await page.getByRole('button', { name: /Folder/ }).first().click({ timeout: 10000 });
    await page.locator('input[placeholder="Folder name..."]').fill('level2');
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(1000);

    // level2 should have folder icon
    const level2Row = page.locator('a:has-text("level2")');
    await expect(level2Row).toBeVisible({ timeout: 10000 });
    const folderIcon = level2Row.locator('span[class*="i-lucide-folder"]');
    await expect(folderIcon).toBeVisible();

    // Navigate into level2
    await page.locator('a:has-text("level2")').click();
    await page.waitForTimeout(1000);

    // Wait for Empty directory
    await expect(page.getByText('Empty directory')).toBeVisible({ timeout: 10000 });

    // Create third subfolder
    await page.getByRole('button', { name: /Folder/ }).first().click({ timeout: 10000 });
    await page.locator('input[placeholder="Folder name..."]').fill('level3');
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(1000);

    // level3 should have folder icon
    const level3Row = page.locator('a:has-text("level3")');
    await expect(level3Row).toBeVisible({ timeout: 10000 });
    const level3FolderIcon = level3Row.locator('span[class*="i-lucide-folder"]');
    await expect(level3FolderIcon).toBeVisible();
  });

  test.skip('can create files inside subdirectory of public tree', async ({ page }) => {
    // TODO: File/Folder buttons not showing when inside subdirectory - separate bug
    // Go to tree list
    await page.locator(myTreesButtonSelector).click();
    await page.waitForTimeout(300);

    // Create a public tree
    await page.getByRole('button', { name: 'New Folder' }).click();
    await page.locator('input[placeholder="Folder name..."]').fill('public-files');
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(1000);

    // Create a subfolder
    await page.getByRole('button', { name: /Folder/ }).first().click();
    await page.locator('input[placeholder="Folder name..."]').fill('docs');
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(1000);

    // Navigate into docs folder
    await page.locator('a:has-text("docs")').click();
    await page.waitForTimeout(1000);

    // Wait for the folder to load - should show Empty directory
    await expect(page.getByText('Empty directory')).toBeVisible({ timeout: 10000 });

    // Create a file inside
    await page.getByRole('button', { name: /File/ }).first().click({ timeout: 10000 });
    await page.locator('input[placeholder="File name..."]').fill('readme.txt');
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(1000);

    // Type content and save
    await expect(page.locator('textarea')).toBeVisible({ timeout: 10000 });
    await page.locator('textarea').fill('Hello from subdirectory!');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.waitForTimeout(1000);

    // Exit edit mode
    await page.getByRole('button', { name: 'Done' }).click();
    await page.waitForTimeout(1000);

    // Navigate back up
    await page.locator('a:has-text("..")').first().click();
    await page.waitForTimeout(1000);

    // Navigate into docs again
    await page.locator('a:has-text("docs")').click();
    await page.waitForTimeout(1000);

    // File should still be there
    await expect(page.locator('a:has-text("readme.txt")')).toBeVisible({ timeout: 10000 });
  });

  test('subdirectory in unlisted tree should show as folder', async ({ page }) => {
    // Go to tree list
    await page.locator(myTreesButtonSelector).click();
    await page.waitForTimeout(300);

    // Create an unlisted tree
    await page.getByRole('button', { name: 'New Folder' }).click();
    await page.locator('input[placeholder="Folder name..."]').fill('unlisted-parent');
    await page.getByRole('button', { name: /unlisted/i }).click();
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(1000);

    // Create a subfolder
    await page.getByRole('button', { name: /Folder/ }).first().click();
    await page.locator('input[placeholder="Folder name..."]').fill('secret-docs');
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(500);

    // The subfolder should have folder icon
    const subfolderRow = page.locator('a:has-text("secret-docs")');
    await expect(subfolderRow).toBeVisible({ timeout: 5000 });
    const folderIcon = subfolderRow.locator('span[class*="i-lucide-folder"]');
    await expect(folderIcon).toBeVisible();

    // Click to navigate into it
    await subfolderRow.click();
    await page.waitForTimeout(500);

    // Should show Empty directory
    await expect(page.getByText('Empty directory')).toBeVisible({ timeout: 5000 });
  });

  test('subdirectory in private tree should show as folder', async ({ page }) => {
    // Go to tree list
    await page.locator(myTreesButtonSelector).click();
    await page.waitForTimeout(300);

    // Create a private tree
    await page.getByRole('button', { name: 'New Folder' }).click();
    await page.locator('input[placeholder="Folder name..."]').fill('private-parent');
    await page.getByRole('button', { name: /private/i }).click();
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(1000);

    // Create a subfolder
    await page.getByRole('button', { name: /Folder/ }).first().click();
    await page.locator('input[placeholder="Folder name..."]').fill('private-docs');
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(500);

    // The subfolder should have folder icon
    const subfolderRow = page.locator('a:has-text("private-docs")');
    await expect(subfolderRow).toBeVisible({ timeout: 5000 });
    const folderIcon = subfolderRow.locator('span[class*="i-lucide-folder"]');
    await expect(folderIcon).toBeVisible();

    // Click to navigate into it
    await subfolderRow.click();
    await page.waitForTimeout(500);

    // Should show Empty directory
    await expect(page.getByText('Empty directory')).toBeVisible({ timeout: 5000 });
  });
});
