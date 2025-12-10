import { test, expect } from '@playwright/test';

test.describe('Permalink Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(500);

    // Login with new user
    await page.getByRole('button', { name: /New/i }).click();
    await page.waitForTimeout(2000);

    // Close any modals
    const cancelButton = page.getByRole('button', { name: 'Cancel' });
    if (await cancelButton.isVisible({ timeout: 500 }).catch(() => false)) {
      await cancelButton.click();
      await page.waitForTimeout(200);
    }
  });

  test('file permalink should display file content', async ({ page }) => {
    // Navigate to public folder
    await page.getByRole('link', { name: 'public' }).first().click();
    await page.waitForTimeout(1000);

    // Create a file
    await page.getByRole('button', { name: /New File/i }).click();
    await page.locator('input[placeholder="File name..."]').fill('permalink-test.txt');
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(500);

    // Type content and save
    await page.locator('textarea').fill('Hello from permalink test content!');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.waitForTimeout(500);

    // Exit edit mode
    await page.getByRole('button', { name: 'Done' }).click();
    await page.waitForTimeout(500);

    // Find the Permalink link in viewer
    const permalinkLink = page.getByRole('link', { name: 'Permalink', exact: true });
    await expect(permalinkLink).toBeVisible({ timeout: 5000 });

    // Get the href
    const permalinkHref = await permalinkLink.getAttribute('href');
    console.log('File Permalink href:', permalinkHref);
    expect(permalinkHref).toBeTruthy();
    expect(permalinkHref).toMatch(/^#\/nhash1/);

    // Navigate to the permalink URL
    await page.goto(`/#${permalinkHref!.slice(1)}`);
    await page.waitForTimeout(1000);

    // Should see the file content
    await expect(page.getByText('Hello from permalink test content!')).toBeVisible({ timeout: 10000 });
  });

  test('directory permalink should display directory listing', async ({ page }) => {
    // Navigate to public folder
    await page.getByRole('link', { name: 'public' }).first().click();
    await page.waitForTimeout(1000);

    // Create a file so directory isn't empty
    await page.getByRole('button', { name: /New File/i }).click();
    await page.locator('input[placeholder="File name..."]').fill('test-in-dir.txt');
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(500);

    // Type content and save
    await page.locator('textarea').fill('Test file content');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.waitForTimeout(500);

    // Exit edit mode
    await page.getByRole('button', { name: 'Done' }).click();
    await page.waitForTimeout(500);

    // Click on "public" breadcrumb link to go back to directory (not ".." which goes to tree list)
    await page.locator('a:has-text("public")').first().click();
    await page.waitForTimeout(1000);

    // Find the directory Permalink link in folder actions
    const dirPermalinkLink = page.getByRole('link', { name: 'Permalink', exact: true }).first();
    await expect(dirPermalinkLink).toBeVisible({ timeout: 5000 });

    // Get the href - should NOT have a filename
    const dirPermalinkHref = await dirPermalinkLink.getAttribute('href');
    console.log('Directory Permalink href:', dirPermalinkHref);
    expect(dirPermalinkHref).toBeTruthy();
    expect(dirPermalinkHref).toMatch(/^#\/nhash1/);
    // Directory permalink should NOT include filename
    expect(dirPermalinkHref).not.toContain('test-in-dir.txt');

    // Navigate to the permalink URL
    await page.goto(`/#${dirPermalinkHref!.slice(1)}`);
    await page.waitForTimeout(1000);

    // Should see the file in the directory listing
    await expect(page.getByText('test-in-dir.txt')).toBeVisible({ timeout: 10000 });
  });

  test('file in permalink directory should display correctly', async ({ page }) => {
    // Create an unlisted (encrypted) tree
    await page.getByRole('button', { name: /New Folder/i }).click();
    await page.waitForTimeout(500);

    await page.locator('input[placeholder="Folder name..."]').fill('permalink-file-test');
    await page.getByRole('button', { name: /unlisted/i }).click();
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(1000);

    // Create a file inside the encrypted tree
    await page.getByRole('button', { name: /New File/i }).click();
    await page.locator('input[placeholder="File name..."]').fill('test-content.txt');
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(500);

    // Type content and save
    await page.locator('textarea').fill('Hello from encrypted file!');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.waitForTimeout(500);

    // Exit edit mode
    await page.getByRole('button', { name: 'Done' }).click();
    await page.waitForTimeout(500);

    // Go back to directory to get permalink
    await page.locator('a:has-text("permalink-file-test")').first().click();
    await page.waitForTimeout(500);

    // Get the directory permalink href
    const dirPermalinkLink = page.getByTestId('permalink-link').first();
    const permalinkHref = await dirPermalinkLink.getAttribute('href');
    console.log('Directory permalink:', permalinkHref);
    expect(permalinkHref).toBeTruthy();

    // Navigate to the directory permalink URL
    await page.goto(`/#${permalinkHref!.slice(1)}`);
    await page.waitForTimeout(1000);

    // Should see the file in the directory listing
    await expect(page.getByText('test-content.txt')).toBeVisible({ timeout: 5000 });

    // Click on the file
    await page.getByRole('link', { name: 'test-content.txt' }).click();
    await page.waitForTimeout(1000);

    // Debug: screenshot before assertion
    await page.screenshot({ path: 'test-results/permalink-file-debug.png' });

    // Should see the file content (not a broken image) - allow more time for decryption
    await expect(page.getByText('Hello from encrypted file!')).toBeVisible({ timeout: 15000 });
  });
});
