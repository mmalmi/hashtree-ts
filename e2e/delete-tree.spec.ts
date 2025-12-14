/**
 * E2E test for tree deletion
 *
 * Tests that deleting a tree removes it from the list and it doesn't reappear.
 */
import { test, expect } from '@playwright/test';
import { setupPageErrorHandler, navigateToPublicFolder, goToTreeList, disableOthersPool } from './test-utils.js';

test.describe('Tree Deletion', () => {
  test('deleted tree should not reappear in tree list', { timeout: 60000 }, async ({ page }) => {
    test.slow();
    setupPageErrorHandler(page);

    // Capture console logs for debugging
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('[list') || text.includes('[emit') || text.includes('[delete') || text.includes('[create') || text.includes('[trees') || text.includes('[resolver') || text.includes('[getRefResolver') || text.includes('[inject') || text.includes('[publish') || text.includes('[event') || text.includes('[raw-event') || text.includes('[nostr-module-init')) {
        console.log(`[BROWSER] ${text}`);
      }
    });

    await page.goto('/');
    await disableOthersPool(page);

    // Wait for app to load
    await page.waitForSelector('header span:has-text("hashtree")', { timeout: 10000 });

    // Go to tree list
    await goToTreeList(page);

    // Create a uniquely named tree
    const treeName = `delete-test-${Date.now()}`;

    // Create a new tree via the UI
    await expect(page.getByRole('button', { name: 'New Folder' })).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'New Folder' }).click();

    // Fill in the tree name in the modal
    await page.locator('input[placeholder="Folder name..."]').fill(treeName);

    // Submit the form
    await page.getByRole('button', { name: 'Create' }).click();

    // Wait for navigation to the new tree (URL should contain tree name)
    await page.waitForURL(new RegExp(treeName), { timeout: 10000 });
    await expect(page.getByText('Empty directory')).toBeVisible({ timeout: 10000 });
    console.log(`Tree "${treeName}" created and navigated`);

    // Now we're in the tree - find and click the Delete button
    const deleteBtn = page.getByRole('button', { name: 'Delete' }).first();
    await expect(deleteBtn).toBeVisible({ timeout: 5000 });

    // Handle confirmation dialog
    page.once('dialog', dialog => {
      console.log(`Confirm dialog: ${dialog.message()}`);
      dialog.accept();
    });

    await deleteBtn.click();

    // Should navigate away (to home) - URL ends with #/ or just #
    await page.waitForURL(/.*#\/?$/, { timeout: 10000 });
    console.log('Navigated to home after delete');

    // Wait a moment for UI to update
    await page.waitForTimeout(1000);

    // Debug: take screenshot
    await page.screenshot({ path: 'test-results/after-delete.png', fullPage: true });

    // Debug: Log what trees are visible
    const treeLinks = await page.locator('[data-testid="file-list"] a').all();
    console.log(`Found ${treeLinks.length} tree links after delete:`);
    for (const link of treeLinks) {
      const text = await link.textContent();
      console.log(`  - ${text}`);
    }

    // Debug: Check resolver state via window
    const resolverState = await page.evaluate(() => {
      // @ts-ignore - accessing internal state for debugging
      const w = window as unknown as { __RESOLVER_DEBUG__?: unknown };
      return w.__RESOLVER_DEBUG__ ?? 'not set';
    });
    console.log('Resolver debug state:', resolverState);

    // Verify tree is NOT in the sidebar (using link role like navigateToPublicFolder does)
    const deletedTree = page.getByRole('link', { name: treeName });

    // Try multiple times with delays to see if tree eventually disappears
    for (let i = 0; i < 3; i++) {
      const count = await deletedTree.count();
      console.log(`Attempt ${i+1}: deletedTree count = ${count}`);
      if (count === 0) break;
      await page.waitForTimeout(1000);
    }

    await expect(deletedTree).not.toBeVisible({ timeout: 5000 });
    console.log('Tree not visible immediately after delete');

    // Wait a bit and check again (to catch reappearance from Nostr)
    await page.waitForTimeout(3000);
    await expect(deletedTree).not.toBeVisible();
    console.log('Tree still not visible after 3s');

    // Reload the page to test persistence
    await page.reload();
    await page.waitForTimeout(2000);

    // Should still not be visible after reload
    await expect(deletedTree).not.toBeVisible({ timeout: 5000 });
    console.log('Tree not visible after page reload');
  });

  test('delete button should be visible at tree root', async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await disableOthersPool(page);

    await page.waitForSelector('header span:has-text("hashtree")', { timeout: 10000 });

    // Navigate to the public folder (default tree)
    await navigateToPublicFolder(page);

    // Debug: take screenshot
    await page.screenshot({ path: 'test-results/delete-btn-debug.png', fullPage: true });

    // At root of tree, should see Delete button in FolderActions
    // The button is within the folder actions toolbar
    const deleteBtn = page.getByRole('button', { name: 'Delete' }).first();
    await expect(deleteBtn).toBeVisible({ timeout: 5000 });

    // The delete button should exist at root level
    console.log('Delete button visible at tree root');
  });
});
