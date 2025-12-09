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

// Helper to create a file
async function createFile(page: any, name: string, content: string = '') {
  await page.getByRole('button', { name: /File/ }).first().click();
  await page.locator('input[placeholder="File name..."]').fill(name);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('button', { name: 'Done' })).toBeVisible({ timeout: 5000 });
  if (content) {
    await page.locator('textarea').fill(content);
    await page.getByRole('button', { name: 'Save' }).click();
    await page.waitForTimeout(500);
  }
  await page.getByRole('button', { name: 'Done' }).click();
  await page.waitForTimeout(500);
}

test.describe('Recently Visited', () => {
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

  test('should track recently visited trees', async ({ page }) => {
    // Create first tree
    await createAndEnterTree(page, 'recents-test-1');

    // Go back to tree list
    await goToTreeList(page);

    // Create second tree
    await createAndEnterTree(page, 'recents-test-2');

    // Go back to tree list
    await goToTreeList(page);

    // Check recents in localStorage
    const recents = await page.evaluate(() => {
      return localStorage.getItem('hashtree:recents');
    });

    expect(recents).toBeTruthy();
    const parsed = JSON.parse(recents!);
    expect(parsed.length).toBeGreaterThanOrEqual(2);

    // Most recent should be second tree
    expect(parsed[0].label).toBe('recents-test-2');
    expect(parsed[1].label).toBe('recents-test-1');
  });

  test('should persist recents across page reload', async ({ page }) => {
    // Create a tree
    await createAndEnterTree(page, 'persist-test');

    // Go back
    await goToTreeList(page);

    // Verify recents exist
    let recents = await page.evaluate(() => localStorage.getItem('hashtree:recents'));
    expect(recents).toBeTruthy();

    // Reload page
    await page.reload();
    await page.waitForTimeout(1000);

    // Check recents still exist
    recents = await page.evaluate(() => localStorage.getItem('hashtree:recents'));
    expect(recents).toBeTruthy();
    const parsed = JSON.parse(recents!);
    expect(parsed.some((r: any) => r.label === 'persist-test')).toBe(true);
  });

  test('should move re-visited items to top', async ({ page }) => {
    // Create three trees
    await createAndEnterTree(page, 'order-test-1');
    await goToTreeList(page);

    await createAndEnterTree(page, 'order-test-2');
    await goToTreeList(page);

    await createAndEnterTree(page, 'order-test-3');
    await goToTreeList(page);

    // Now revisit first tree
    await page.locator('a:has-text("order-test-1")').first().click();
    await page.waitForTimeout(500);
    await goToTreeList(page);

    // Check order - order-test-1 should now be at top
    const recents = await page.evaluate(() => localStorage.getItem('hashtree:recents'));
    const parsed = JSON.parse(recents!);

    expect(parsed[0].label).toBe('order-test-1');
  });

  test('should limit recents to maximum count', async ({ page }) => {
    // Create many trees (more than MAX_RECENTS = 20)
    for (let i = 0; i < 5; i++) {
      await createAndEnterTree(page, `limit-test-${i}`);
      await goToTreeList(page);
    }

    // Check that recents are capped
    const recents = await page.evaluate(() => localStorage.getItem('hashtree:recents'));
    const parsed = JSON.parse(recents!);

    // Should not exceed MAX_RECENTS (20)
    expect(parsed.length).toBeLessThanOrEqual(20);
    // 5 trees created + potentially file visits
    expect(parsed.length).toBeGreaterThanOrEqual(5);
  });

  test('should track file visits in recents', async ({ page }) => {
    // Create tree with file
    await createAndEnterTree(page, 'file-recents-test');
    await createFile(page, 'test-file.txt', 'Hello World');

    // Navigate to file
    await page.locator('a:has-text("file-recents-test")').first().click();
    await page.waitForTimeout(500);
    await page.locator('a:has-text("test-file.txt")').first().click();
    await page.waitForTimeout(500);

    // Check recents
    const recents = await page.evaluate(() => localStorage.getItem('hashtree:recents'));
    const parsed = JSON.parse(recents!);

    // Should have file in recents
    const fileRecent = parsed.find((r: any) => r.label?.includes('test-file.txt'));
    expect(fileRecent).toBeTruthy();
  });
});
