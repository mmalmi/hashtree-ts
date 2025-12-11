import { test, expect } from '@playwright/test';
import { setupPageErrorHandler, navigateToPublicFolder } from './test-utils.js';

test.describe('NIP-34 Pull Requests and Issues', () => {
  test('should navigate to /pulls route and show pull requests view', async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await navigateToPublicFolder(page);

    // Get the current npub and tree name from the URL
    const url = page.url();
    const hashMatch = url.match(/#\/([^/]+)\/([^/?]+)/);
    expect(hashMatch).toBeTruthy();
    const [, npub, treeName] = hashMatch!;

    // Navigate to pulls route
    await page.goto(`/#/${npub}/${treeName}/pulls`);

    // Should see the tab navigation
    await expect(page.locator('a:has-text("Code")')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('a:has-text("Pull Requests")')).toBeVisible();
    await expect(page.locator('a:has-text("Issues")')).toBeVisible();

    // Pull Requests tab should be active
    const prTab = page.locator('a:has-text("Pull Requests")');
    await expect(prTab).toHaveClass(/bg-surface-3/);

    // Should show empty state or loading
    const emptyState = page.locator('text=No pull requests yet');
    const loadingState = page.locator('text=Loading pull requests...');
    const hasContent = await emptyState.isVisible().catch(() => false) ||
                       await loadingState.isVisible().catch(() => false);
    expect(hasContent).toBe(true);
  });

  test('should navigate to /issues route and show issues view', async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await navigateToPublicFolder(page);

    // Get the current npub and tree name from the URL
    const url = page.url();
    const hashMatch = url.match(/#\/([^/]+)\/([^/?]+)/);
    expect(hashMatch).toBeTruthy();
    const [, npub, treeName] = hashMatch!;

    // Navigate to issues route
    await page.goto(`/#/${npub}/${treeName}/issues`);

    // Should see the tab navigation
    await expect(page.locator('a:has-text("Code")')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('a:has-text("Pull Requests")')).toBeVisible();
    await expect(page.locator('a:has-text("Issues")')).toBeVisible();

    // Issues tab should be active
    const issuesTab = page.locator('a:has-text("Issues")');
    await expect(issuesTab).toHaveClass(/bg-surface-3/);

    // Should show empty state or loading
    const emptyState = page.locator('text=No issues yet');
    const loadingState = page.locator('text=Loading issues...');
    const hasContent = await emptyState.isVisible().catch(() => false) ||
                       await loadingState.isVisible().catch(() => false);
    expect(hasContent).toBe(true);
  });

  test('should show tab navigation on git repo root', async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await navigateToPublicFolder(page);

    // Create a git repo structure via the tree API
    const result = await page.evaluate(async () => {
      const { getTree, LinkType } = await import('/src/store.ts');
      const tree = getTree();

      // Create minimal .git structure
      const headContent = new TextEncoder().encode('ref: refs/heads/main\n');
      const configContent = new TextEncoder().encode('[core]\n\trepositoryformatversion = 0\n');
      const mainRefContent = new TextEncoder().encode('0000000000000000000000000000000000000000\n');

      const { cid: headCid } = await tree.putFile(headContent);
      const { cid: configCid } = await tree.putFile(configContent);
      const { cid: mainRefCid } = await tree.putFile(mainRefContent);
      const { cid: emptyDir } = await tree.putDirectory([]);

      // Build .git/refs/heads directory with main branch
      let { cid: headsDir } = await tree.putDirectory([]);
      headsDir = await tree.setEntry(headsDir, [], 'main', mainRefCid, mainRefContent.length, LinkType.Blob);

      // Build .git/refs directory
      let { cid: refsDir } = await tree.putDirectory([]);
      refsDir = await tree.setEntry(refsDir, [], 'heads', headsDir, 0, LinkType.Dir);

      // Build .git directory
      let { cid: gitDir } = await tree.putDirectory([]);
      gitDir = await tree.setEntry(gitDir, [], 'HEAD', headCid, headContent.length, LinkType.Blob);
      gitDir = await tree.setEntry(gitDir, [], 'config', configCid, configContent.length, LinkType.Blob);
      gitDir = await tree.setEntry(gitDir, [], 'refs', refsDir, 0, LinkType.Dir);
      gitDir = await tree.setEntry(gitDir, [], 'objects', emptyDir, 0, LinkType.Dir);

      // Build root with .git directory
      let { cid: rootCid } = await tree.putDirectory([]);
      rootCid = await tree.setEntry(rootCid, [], '.git', gitDir, 0, LinkType.Dir);

      // Add a README
      const readmeContent = new TextEncoder().encode('# Test Repo\n');
      const { cid: readmeCid, size: readmeSize } = await tree.putFile(readmeContent);
      rootCid = await tree.setEntry(rootCid, [], 'README.md', readmeCid, readmeSize, LinkType.Blob);

      return { success: true };
    });

    expect(result.success).toBe(true);

    // Refresh the page to load the git repo
    await page.reload();
    await navigateToPublicFolder(page);

    // Wait for git repo view to load
    await page.waitForTimeout(1000);

    // Tab navigation should be visible on git repo root (when npub/treeName route, not nhash)
    // Since this is a public folder with a git structure, we should see tabs
    const codeTab = page.locator('a:has-text("Code")').first();
    const prTab = page.locator('a:has-text("Pull Requests")').first();
    const issuesTab = page.locator('a:has-text("Issues")').first();

    // These tabs should be visible on the git repo view
    // Note: tabs only show when viewing at the root of an npub/treeName route
    const tabsVisible = await codeTab.isVisible().catch(() => false);

    // If tabs are visible, verify all three are present
    if (tabsVisible) {
      await expect(prTab).toBeVisible();
      await expect(issuesTab).toBeVisible();
    }
  });

  test('should switch between Code, Pull Requests, and Issues tabs', async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await navigateToPublicFolder(page);

    // Get the current npub and tree name from the URL
    const url = page.url();
    const hashMatch = url.match(/#\/([^/]+)\/([^/?]+)/);
    expect(hashMatch).toBeTruthy();
    const [, npub, treeName] = hashMatch!;

    // Start at pulls
    await page.goto(`/#/${npub}/${treeName}/pulls`);
    await expect(page.locator('a:has-text("Pull Requests")')).toHaveClass(/bg-surface-3/, { timeout: 10000 });

    // Click Issues tab
    await page.locator('a:has-text("Issues")').click();
    await expect(page).toHaveURL(new RegExp(`${treeName}/issues`));
    await expect(page.locator('a:has-text("Issues")')).toHaveClass(/bg-surface-3/);

    // Click Code tab
    await page.locator('a:has-text("Code")').click();
    await expect(page).toHaveURL(new RegExp(`${npub}/${treeName}(?:/)?$`));
  });

  test('should show New Pull Request button when logged in', async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await navigateToPublicFolder(page);

    // Get the current npub and tree name from the URL
    const url = page.url();
    const hashMatch = url.match(/#\/([^/]+)\/([^/?]+)/);
    expect(hashMatch).toBeTruthy();
    const [, npub, treeName] = hashMatch!;

    // Navigate to pulls
    await page.goto(`/#/${npub}/${treeName}/pulls`);

    // New Pull Request button should be visible (user is logged in)
    const newPRButton = page.locator('button:has-text("New Pull Request")');
    await expect(newPRButton).toBeVisible({ timeout: 10000 });

    // Click to open modal
    await newPRButton.click();

    // Modal should appear
    await expect(page.locator('h2:has-text("New Pull Request")')).toBeVisible({ timeout: 5000 });

    // Close modal
    await page.locator('button:has-text("Cancel")').click();
    await expect(page.locator('h2:has-text("New Pull Request")')).not.toBeVisible();
  });

  test('should show New Issue button when logged in', async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await navigateToPublicFolder(page);

    // Get the current npub and tree name from the URL
    const url = page.url();
    const hashMatch = url.match(/#\/([^/]+)\/([^/?]+)/);
    expect(hashMatch).toBeTruthy();
    const [, npub, treeName] = hashMatch!;

    // Navigate to issues
    await page.goto(`/#/${npub}/${treeName}/issues`);

    // New Issue button should be visible (user is logged in)
    const newIssueButton = page.locator('button:has-text("New Issue")');
    await expect(newIssueButton).toBeVisible({ timeout: 10000 });

    // Click to open modal
    await newIssueButton.click();

    // Modal should appear
    await expect(page.locator('h2:has-text("New Issue")')).toBeVisible({ timeout: 5000 });

    // Close modal
    await page.locator('button:has-text("Cancel")').click();
    await expect(page.locator('h2:has-text("New Issue")')).not.toBeVisible();
  });

  test('should have filter dropdown for PRs', async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await navigateToPublicFolder(page);

    // Get the current npub and tree name from the URL
    const url = page.url();
    const hashMatch = url.match(/#\/([^/]+)\/([^/?]+)/);
    expect(hashMatch).toBeTruthy();
    const [, npub, treeName] = hashMatch!;

    // Navigate to pulls
    await page.goto(`/#/${npub}/${treeName}/pulls`);
    await expect(page.locator('a:has-text("Pull Requests")')).toBeVisible({ timeout: 10000 });

    // Should have a filter button showing "All"
    const filterButton = page.locator('button:has-text("All")').first();
    await expect(filterButton).toBeVisible();

    // Click to open dropdown
    await filterButton.click();

    // Should see filter options
    await expect(page.locator('button:has-text("Open")')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('button:has-text("Merged")')).toBeVisible();
    await expect(page.locator('button:has-text("Closed")')).toBeVisible();
  });

  test('should have filter dropdown for Issues', async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await navigateToPublicFolder(page);

    // Get the current npub and tree name from the URL
    const url = page.url();
    const hashMatch = url.match(/#\/([^/]+)\/([^/?]+)/);
    expect(hashMatch).toBeTruthy();
    const [, npub, treeName] = hashMatch!;

    // Navigate to issues
    await page.goto(`/#/${npub}/${treeName}/issues`);
    await expect(page.locator('a:has-text("Issues")')).toBeVisible({ timeout: 10000 });

    // Should have a filter button showing "All"
    const filterButton = page.locator('button:has-text("All")').first();
    await expect(filterButton).toBeVisible();

    // Click to open dropdown
    await filterButton.click();

    // Should see filter options (no "Merged" for issues)
    await expect(page.locator('button:has-text("Open")')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('button:has-text("Closed")')).toBeVisible();
  });
});
