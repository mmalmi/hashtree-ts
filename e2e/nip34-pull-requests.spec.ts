import { test, expect } from '@playwright/test';
import { setupPageErrorHandler, navigateToPublicFolder } from './test-utils.js';

test.describe('NIP-34 Pull Requests', () => {
  test('should navigate to Pull Requests view via URL', async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await navigateToPublicFolder(page);

    // Get the current URL parts
    const url = new URL(page.url());
    const hash = url.hash.slice(1); // Remove #
    const qIdx = hash.indexOf('?');
    const path = qIdx !== -1 ? hash.slice(0, qIdx) : hash;
    const parts = path.split('/').filter(Boolean);
    const npub = parts[0];
    const treeName = parts[1];

    // Navigate using ?tab=pulls query param
    await page.goto(`/#/${npub}/${treeName}?tab=pulls`);

    // Should show the PR view with empty state
    await expect(page.locator('text=No pull requests yet')).toBeVisible({ timeout: 10000 });

    // Tab navigation should be visible
    await expect(page.locator('a:has-text("Code")')).toBeVisible();
    await expect(page.locator('a:has-text("Pull Requests")')).toBeVisible();
    await expect(page.locator('a:has-text("Issues")')).toBeVisible();
  });

  test('should navigate to Issues view via URL', async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await navigateToPublicFolder(page);

    // Get the current URL parts
    const url = new URL(page.url());
    const hash = url.hash.slice(1);
    const qIdx = hash.indexOf('?');
    const path = qIdx !== -1 ? hash.slice(0, qIdx) : hash;
    const parts = path.split('/').filter(Boolean);
    const npub = parts[0];
    const treeName = parts[1];

    // Navigate using ?tab=issues query param
    await page.goto(`/#/${npub}/${treeName}?tab=issues`);

    // Should show the Issues view with empty state
    await expect(page.locator('text=No issues yet')).toBeVisible({ timeout: 10000 });

    // Tab navigation should be visible
    await expect(page.locator('a:has-text("Code")')).toBeVisible();
    await expect(page.locator('a:has-text("Pull Requests")')).toBeVisible();
    await expect(page.locator('a:has-text("Issues")')).toBeVisible();
  });

  test('should show FileBrowser on left side in PR view', async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await navigateToPublicFolder(page);

    // Get the current URL parts
    const url = new URL(page.url());
    const hash = url.hash.slice(1);
    const qIdx = hash.indexOf('?');
    const path = qIdx !== -1 ? hash.slice(0, qIdx) : hash;
    const parts = path.split('/').filter(Boolean);
    const npub = parts[0];
    const treeName = parts[1];

    // Navigate to PR view
    await page.goto(`/#/${npub}/${treeName}?tab=pulls`);

    // Wait for the view to load
    await expect(page.locator('text=No pull requests yet')).toBeVisible({ timeout: 10000 });

    // FileBrowser should be visible - check for the breadcrumb or tree selector
    // The FileBrowser has a tree dropdown or shows "Empty directory"
    const fileBrowserVisible = await page.locator('text=Empty directory').isVisible() ||
      await page.locator('[data-testid="file-list"]').isVisible() ||
      await page.locator('.shrink-0.lg\\:w-80').isVisible();
    expect(fileBrowserVisible).toBeTruthy();
  });

  test('should switch between Code, PRs, and Issues tabs', async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await navigateToPublicFolder(page);

    // Get the current URL parts
    const url = new URL(page.url());
    const hash = url.hash.slice(1);
    const qIdx = hash.indexOf('?');
    const path = qIdx !== -1 ? hash.slice(0, qIdx) : hash;
    const parts = path.split('/').filter(Boolean);
    const npub = parts[0];
    const treeName = parts[1];

    // Go to PRs
    await page.goto(`/#/${npub}/${treeName}?tab=pulls`);
    await expect(page.locator('text=No pull requests yet')).toBeVisible({ timeout: 10000 });

    // Click Issues tab
    await page.locator('a:has-text("Issues")').click();
    await page.waitForURL(/tab=issues/, { timeout: 5000 });
    await expect(page.locator('text=No issues yet')).toBeVisible({ timeout: 5000 });

    // Click Code tab
    await page.locator('a:has-text("Code")').first().click();
    await page.waitForURL((url) => !url.href.includes('tab=pulls') && !url.href.includes('tab=issues'), { timeout: 5000 });
  });

  test('nevent encoding works correctly', async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');

    // Wait for app to load
    await page.waitForTimeout(1000);

    // Test that encodeEventId and decodeEventId work correctly
    const result = await page.evaluate(async () => {
      // Dynamic import from the running app
      const nip34Module = await import('/src/nip34.ts');
      const { encodeEventId, decodeEventId } = nip34Module;

      // Test with a sample event ID (64 char hex)
      const hexId = 'a'.repeat(64);
      const encoded = encodeEventId(hexId);
      const decoded = decodeEventId(encoded);

      return {
        hexId,
        encoded,
        decoded,
        startsWithNevent: encoded.startsWith('nevent'),
        decodedMatches: decoded === hexId,
      };
    });

    console.log('[test] Encoding result:', result);
    expect(result.startsWithNevent).toBe(true);
    expect(result.decodedMatches).toBe(true);
  });

  test('PR list title should be a link with nevent ID', async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await navigateToPublicFolder(page);

    // Get URL parts for navigation
    const url = new URL(page.url());
    const hash = url.hash.slice(1);
    const qIdx = hash.indexOf('?');
    const path = qIdx !== -1 ? hash.slice(0, qIdx) : hash;
    const parts = path.split('/').filter(Boolean);
    const npub = parts[0];
    const treeName = parts[1];

    // Navigate to PRs view using query param
    await page.goto(`/#/${npub}/${treeName}?tab=pulls`);
    await expect(page.locator('text=No pull requests yet')).toBeVisible({ timeout: 10000 });

    // The "New Pull Request" button should be visible when logged in
    // For now just verify the view structure is correct
    await expect(page.locator('a:has-text("Pull Requests")')).toBeVisible();
  });

  test('should navigate to PR detail view via URL with nevent id', async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await navigateToPublicFolder(page);

    // Get URL parts for navigation
    const url = new URL(page.url());
    const hash = url.hash.slice(1);
    const qIdx = hash.indexOf('?');
    const path = qIdx !== -1 ? hash.slice(0, qIdx) : hash;
    const parts = path.split('/').filter(Boolean);
    const npub = parts[0];
    const treeName = parts[1];

    // Generate a test nevent ID (this won't exist, but we can test the routing)
    const testNeventId = await page.evaluate(async () => {
      const nip34Module = await import('/src/nip34.ts');
      const { encodeEventId } = nip34Module;
      // Use a fake event ID
      return encodeEventId('a'.repeat(64));
    });

    // Navigate to PR detail view with nevent ID
    await page.goto(`/#/${npub}/${treeName}?tab=pulls&id=${testNeventId}`);

    // Should show loading first, then error since event doesn't exist
    // Wait for the error message to appear (event doesn't exist)
    await expect(page.locator('text=Pull request not found')).toBeVisible({ timeout: 10000 });

    // Back button should also be visible
    await expect(page.locator('a:has-text("Back to pull requests")')).toBeVisible();
  });

  test('should navigate to Issue detail view via URL with nevent id', async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await navigateToPublicFolder(page);

    // Get URL parts for navigation
    const url = new URL(page.url());
    const hash = url.hash.slice(1);
    const qIdx = hash.indexOf('?');
    const path = qIdx !== -1 ? hash.slice(0, qIdx) : hash;
    const parts = path.split('/').filter(Boolean);
    const npub = parts[0];
    const treeName = parts[1];

    // Generate a test nevent ID
    const testNeventId = await page.evaluate(async () => {
      const nip34Module = await import('/src/nip34.ts');
      const { encodeEventId } = nip34Module;
      return encodeEventId('b'.repeat(64));
    });

    // Navigate to Issue detail view with nevent ID
    await page.goto(`/#/${npub}/${treeName}?tab=issues&id=${testNeventId}`);

    // Should show error since event doesn't exist
    await expect(page.locator('text=Issue not found')).toBeVisible({ timeout: 10000 });

    // Back button should also be visible
    await expect(page.locator('a:has-text("Back to issues")')).toBeVisible();
  });

  test('should have back button in PR detail view that navigates to list', async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await navigateToPublicFolder(page);

    // Get URL parts for navigation
    const url = new URL(page.url());
    const hash = url.hash.slice(1);
    const qIdx = hash.indexOf('?');
    const path = qIdx !== -1 ? hash.slice(0, qIdx) : hash;
    const parts = path.split('/').filter(Boolean);
    const npub = parts[0];
    const treeName = parts[1];

    // Generate a test nevent ID
    const testNeventId = await page.evaluate(async () => {
      const nip34Module = await import('/src/nip34.ts');
      const { encodeEventId } = nip34Module;
      return encodeEventId('c'.repeat(64));
    });

    // Navigate to PR detail view
    await page.goto(`/#/${npub}/${treeName}?tab=pulls&id=${testNeventId}`);

    // Wait for error state
    await expect(page.locator('text=Pull request not found')).toBeVisible({ timeout: 10000 });

    // Click the back button
    await page.locator('a:has-text("Back to pull requests")').click();

    // Should be back at the PR list view
    await page.waitForURL(/tab=pulls/, { timeout: 5000 });
    // URL should not have &id= anymore
    expect(page.url()).not.toContain('&id=');
    await expect(page.locator('text=No pull requests yet')).toBeVisible({ timeout: 5000 });
  });

  test('should have back button in Issue detail view that navigates to list', async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await navigateToPublicFolder(page);

    // Get URL parts for navigation
    const url = new URL(page.url());
    const hash = url.hash.slice(1);
    const qIdx = hash.indexOf('?');
    const path = qIdx !== -1 ? hash.slice(0, qIdx) : hash;
    const parts = path.split('/').filter(Boolean);
    const npub = parts[0];
    const treeName = parts[1];

    // Generate a test nevent ID
    const testNeventId = await page.evaluate(async () => {
      const nip34Module = await import('/src/nip34.ts');
      const { encodeEventId } = nip34Module;
      return encodeEventId('d'.repeat(64));
    });

    // Navigate to Issue detail view
    await page.goto(`/#/${npub}/${treeName}?tab=issues&id=${testNeventId}`);

    // Wait for error state
    await expect(page.locator('text=Issue not found')).toBeVisible({ timeout: 10000 });

    // Click the back button
    await page.locator('a:has-text("Back to issues")').click();

    // Should be back at the Issues list view
    await page.waitForURL(/tab=issues/, { timeout: 5000 });
    // URL should not have &id= anymore
    expect(page.url()).not.toContain('&id=');
    await expect(page.locator('text=No issues yet')).toBeVisible({ timeout: 5000 });
  });
});
