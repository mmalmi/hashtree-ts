import { test, expect } from '@playwright/test';

test.describe('Permalink Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');

    // Wait for app to load
    await expect(page.locator('header span:has-text("hashtree")')).toBeVisible({ timeout: 5000 });

    // Login with new user
    await page.getByRole('button', { name: /New/i }).click();

    // Wait for login to complete - user should see their tree list
    await expect(page.getByRole('link', { name: 'public' })).toBeVisible({ timeout: 10000 });

    // Close any modals
    const cancelButton = page.getByRole('button', { name: 'Cancel' });
    if (await cancelButton.isVisible({ timeout: 500 }).catch(() => false)) {
      await cancelButton.click();
    }
  });

  test('file permalink should display file content', async ({ page }) => {
    // Navigate to public folder
    await page.getByRole('link', { name: 'public' }).first().click();
    await expect(page.getByRole('button', { name: /New File/i })).toBeVisible({ timeout: 5000 });

    // Create a file
    await page.getByRole('button', { name: /New File/i }).click();
    await expect(page.locator('input[placeholder="File name..."]')).toBeVisible({ timeout: 3000 });
    await page.locator('input[placeholder="File name..."]').fill('permalink-test.txt');
    await page.getByRole('button', { name: 'Create' }).click();

    // Wait for editor
    await expect(page.locator('textarea')).toBeVisible({ timeout: 5000 });
    await page.locator('textarea').fill('Hello from permalink test content!');
    await page.getByRole('button', { name: 'Save' }).click();

    // Wait for save to complete, then exit edit mode
    await expect(page.getByRole('button', { name: 'Done' })).toBeVisible({ timeout: 3000 });
    await page.getByRole('button', { name: 'Done' }).click();

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

    // Should see the file content
    await expect(page.getByText('Hello from permalink test content!')).toBeVisible({ timeout: 10000 });
  });

  test('directory permalink should display directory listing', async ({ page }) => {
    // Navigate to public folder
    await page.getByRole('link', { name: 'public' }).first().click();
    await expect(page.getByRole('button', { name: /New File/i })).toBeVisible({ timeout: 5000 });

    // Create a file so directory isn't empty
    await page.getByRole('button', { name: /New File/i }).click();
    await expect(page.locator('input[placeholder="File name..."]')).toBeVisible({ timeout: 3000 });
    await page.locator('input[placeholder="File name..."]').fill('test-in-dir.txt');
    await page.getByRole('button', { name: 'Create' }).click();

    // Wait for editor and add content
    await expect(page.locator('textarea')).toBeVisible({ timeout: 5000 });
    await page.locator('textarea').fill('Test file content');
    await page.getByRole('button', { name: 'Save' }).click();

    // Exit edit mode
    await expect(page.getByRole('button', { name: 'Done' })).toBeVisible({ timeout: 3000 });
    await page.getByRole('button', { name: 'Done' }).click();

    // Wait for modal backdrop to close before clicking links
    await expect(page.locator('[data-modal-backdrop]')).not.toBeVisible({ timeout: 5000 });

    // Click on "public" breadcrumb link to go back to directory
    const publicLink = page.locator('a:has-text("public")').first();
    await expect(publicLink).toBeVisible({ timeout: 5000 });
    await publicLink.click();

    // Wait for directory view to load - the file should be visible in the file list
    await expect(page.getByTestId('file-list').locator('text=test-in-dir.txt')).toBeVisible({ timeout: 5000 });

    // Find the directory Permalink link in folder actions (should be in DirectoryActions, not Viewer)
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

    // Should see the file in the directory listing
    await expect(page.getByText('test-in-dir.txt')).toBeVisible({ timeout: 10000 });
  });

  test('file in permalink directory should display correctly', async ({ page }) => {
    // Create an unlisted (encrypted) tree
    await page.getByRole('button', { name: /New Folder/i }).click();
    await expect(page.locator('input[placeholder="Folder name..."]')).toBeVisible({ timeout: 3000 });

    await page.locator('input[placeholder="Folder name..."]').fill('permalink-file-test');
    await page.getByRole('button', { name: /unlisted/i }).click();
    await page.getByRole('button', { name: 'Create' }).click();

    // Wait for navigation into the new tree (shows empty directory or New File button)
    await expect(page.getByRole('button', { name: /New File/i })).toBeVisible({ timeout: 10000 });

    // Create a file inside the encrypted tree
    await page.getByRole('button', { name: /New File/i }).click();
    await expect(page.locator('input[placeholder="File name..."]')).toBeVisible({ timeout: 3000 });
    await page.locator('input[placeholder="File name..."]').fill('test-content.txt');
    await page.getByRole('button', { name: 'Create' }).click();

    // Wait for editor and add content
    await expect(page.locator('textarea')).toBeVisible({ timeout: 5000 });
    await page.locator('textarea').fill('Hello from encrypted file!');
    await page.getByRole('button', { name: 'Save' }).click();

    // Exit edit mode
    await expect(page.getByRole('button', { name: 'Done' })).toBeVisible({ timeout: 3000 });
    await page.getByRole('button', { name: 'Done' }).click();

    // Wait for any modal to close before clicking
    await expect(page.locator('[data-modal-backdrop]')).not.toBeVisible({ timeout: 5000 });

    // Go back to directory to get permalink - wait for the breadcrumb link
    const treeLink = page.locator('a:has-text("permalink-file-test")').first();
    await expect(treeLink).toBeVisible({ timeout: 5000 });
    await treeLink.click();

    // Get the directory permalink href - use visible link (there are two, one hidden on desktop)
    const dirPermalinkLink = page.getByRole('link', { name: 'Permalink', exact: true }).first();
    await expect(dirPermalinkLink).toBeVisible({ timeout: 5000 });
    const permalinkHref = await dirPermalinkLink.getAttribute('href');
    console.log('Directory permalink:', permalinkHref);
    expect(permalinkHref).toBeTruthy();

    // Navigate to the directory permalink URL
    await page.goto(`/#${permalinkHref!.slice(1)}`);

    // Wait for page to load and decrypt - file should appear in listing
    // The permalink page may need time to decrypt and load directory entries
    await expect(page.getByText('test-content.txt')).toBeVisible({ timeout: 15000 });

    // Click on the file
    await page.getByRole('link', { name: 'test-content.txt' }).click();

    // Should see the file content (not a broken image) - allow more time for decryption
    await expect(page.getByText('Hello from encrypted file!')).toBeVisible({ timeout: 15000 });
  });
});
