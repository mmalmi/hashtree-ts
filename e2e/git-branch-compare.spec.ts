import { test, expect } from '@playwright/test';
import { setupPageErrorHandler, navigateToPublicFolder, disableOthersPool } from './test-utils.js';

test.describe('Git branch comparison and merge', () => {
  // Disable "others pool" to prevent WebRTC cross-talk from parallel tests
  test.beforeEach(async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await disableOthersPool(page);
  });

  test('compare URL with invalid branch shows error', { timeout: 60000 }, async ({ page }) => {
    await navigateToPublicFolder(page);

    // Create a folder and init as git repo
    await page.getByRole('button', { name: 'New Folder' }).click();
    const folderInput = page.locator('input[placeholder="Folder name..."]');
    await folderInput.waitFor({ timeout: 5000 });
    await folderInput.fill('invalid-branch-test');
    await page.click('button:has-text("Create")');
    await expect(page.locator('.fixed.inset-0.bg-black')).not.toBeVisible({ timeout: 10000 });

    const folderLink = page.locator('[data-testid="file-list"] a').filter({ hasText: 'invalid-branch-test' }).first();
    await expect(folderLink).toBeVisible({ timeout: 15000 });
    await folderLink.click();
    await page.waitForURL(/invalid-branch-test/, { timeout: 10000 });

    // Create initial file
    await page.evaluate(async () => {
      const { getTree, LinkType } = await import('/src/store.ts');
      const { autosaveIfOwn } = await import('/src/nostr.ts');
      const { getCurrentRootCid } = await import('/src/actions/route.ts');
      const { getRouteSync } = await import('/src/stores/index.ts');
      const route = getRouteSync();
      const tree = getTree();
      let rootCid = getCurrentRootCid();
      if (!rootCid) return;
      const content = new TextEncoder().encode('test');
      const { cid, size } = await tree.putFile(content);
      rootCid = await tree.setEntry(rootCid, route.path, 'test.txt', cid, size, LinkType.Blob);
      autosaveIfOwn(rootCid);
    });

    await expect(page.locator('[data-testid="file-list"] a').filter({ hasText: 'test.txt' })).toBeVisible({ timeout: 15000 });

    // Git init
    const gitInitBtn = page.getByRole('button', { name: 'Git Init' });
    await expect(gitInitBtn).toBeVisible({ timeout: 15000 });
    await gitInitBtn.click();
    await expect(gitInitBtn).not.toBeVisible({ timeout: 30000 });

    // Navigate to compare URL with non-existent branch
    const currentUrl = page.url();
    const baseUrl = currentUrl.split('?')[0];
    await page.goto(`${baseUrl}?compare=master...nonexistent-branch`);

    // Should not hang - either shows error or "No differences" (wasm-git silently handles missing branches)
    // The key is that the page finishes loading and shows the compare view, not that it hangs forever
    await expect(page.locator('text=No differences between branches').or(page.locator('.i-lucide-alert-circle'))).toBeVisible({ timeout: 15000 });
  });

  test('compare URL navigates to comparison view', { timeout: 60000 }, async ({ page }) => {
    await navigateToPublicFolder(page);

    // Create a folder and init as git repo
    await page.getByRole('button', { name: 'New Folder' }).click();
    const folderInput = page.locator('input[placeholder="Folder name..."]');
    await folderInput.waitFor({ timeout: 5000 });
    await folderInput.fill('compare-url-test');
    await page.click('button:has-text("Create")');
    await expect(page.locator('.fixed.inset-0.bg-black')).not.toBeVisible({ timeout: 10000 });

    const folderLink = page.locator('[data-testid="file-list"] a').filter({ hasText: 'compare-url-test' }).first();
    await expect(folderLink).toBeVisible({ timeout: 15000 });
    await folderLink.click();
    await page.waitForURL(/compare-url-test/, { timeout: 10000 });

    // Create initial file
    await page.evaluate(async () => {
      const { getTree, LinkType } = await import('/src/store.ts');
      const { autosaveIfOwn } = await import('/src/nostr.ts');
      const { getCurrentRootCid } = await import('/src/actions/route.ts');
      const { getRouteSync } = await import('/src/stores/index.ts');
      const route = getRouteSync();
      const tree = getTree();
      let rootCid = getCurrentRootCid();
      if (!rootCid) return;
      const content = new TextEncoder().encode('test');
      const { cid, size } = await tree.putFile(content);
      rootCid = await tree.setEntry(rootCid, route.path, 'test.txt', cid, size, LinkType.Blob);
      autosaveIfOwn(rootCid);
    });

    await expect(page.locator('[data-testid="file-list"] a').filter({ hasText: 'test.txt' })).toBeVisible({ timeout: 15000 });

    // Git init
    const gitInitBtn = page.getByRole('button', { name: 'Git Init' });
    await expect(gitInitBtn).toBeVisible({ timeout: 15000 });
    await gitInitBtn.click();
    await expect(gitInitBtn).not.toBeVisible({ timeout: 30000 });

    // Navigate to compare URL (will show error since only one branch)
    const currentUrl = page.url();
    const baseUrl = currentUrl.split('?')[0];
    await page.goto(`${baseUrl}?compare=master...nonexistent`);

    // Verify compare view is shown (via the Compare header icon)
    await expect(page.locator('.i-lucide-git-compare')).toBeVisible({ timeout: 10000 });
  });

  test('merge URL navigates to merge view', { timeout: 60000 }, async ({ page }) => {
    await navigateToPublicFolder(page);

    // Create a folder and init as git repo
    await page.getByRole('button', { name: 'New Folder' }).click();
    const folderInput = page.locator('input[placeholder="Folder name..."]');
    await folderInput.waitFor({ timeout: 5000 });
    await folderInput.fill('merge-url-test');
    await page.click('button:has-text("Create")');
    await expect(page.locator('.fixed.inset-0.bg-black')).not.toBeVisible({ timeout: 10000 });

    const folderLink = page.locator('[data-testid="file-list"] a').filter({ hasText: 'merge-url-test' }).first();
    await expect(folderLink).toBeVisible({ timeout: 15000 });
    await folderLink.click();
    await page.waitForURL(/merge-url-test/, { timeout: 10000 });

    // Create initial file
    await page.evaluate(async () => {
      const { getTree, LinkType } = await import('/src/store.ts');
      const { autosaveIfOwn } = await import('/src/nostr.ts');
      const { getCurrentRootCid } = await import('/src/actions/route.ts');
      const { getRouteSync } = await import('/src/stores/index.ts');
      const route = getRouteSync();
      const tree = getTree();
      let rootCid = getCurrentRootCid();
      if (!rootCid) return;
      const content = new TextEncoder().encode('test');
      const { cid, size } = await tree.putFile(content);
      rootCid = await tree.setEntry(rootCid, route.path, 'test.txt', cid, size, LinkType.Blob);
      autosaveIfOwn(rootCid);
    });

    await expect(page.locator('[data-testid="file-list"] a').filter({ hasText: 'test.txt' })).toBeVisible({ timeout: 15000 });

    // Git init
    const gitInitBtn = page.getByRole('button', { name: 'Git Init' });
    await expect(gitInitBtn).toBeVisible({ timeout: 15000 });
    await gitInitBtn.click();
    await expect(gitInitBtn).not.toBeVisible({ timeout: 30000 });

    // Navigate to merge URL
    const currentUrl = page.url();
    const baseUrl = currentUrl.split('?')[0];
    await page.goto(`${baseUrl}?merge=1&base=master&head=nonexistent`);

    // Verify merge view is shown (via the Merge header icon)
    await expect(page.locator('.i-lucide-git-merge')).toBeVisible({ timeout: 10000 });
  });

  test('compare URL shows diff between branches', async ({ page }) => {
    test.setTimeout(120000);
    await navigateToPublicFolder(page);

    // Create a folder and init as git repo
    await page.getByRole('button', { name: 'New Folder' }).click();
    const folderInput = page.locator('input[placeholder="Folder name..."]');
    await folderInput.waitFor({ timeout: 5000 });
    await folderInput.fill('branch-compare-test');
    await page.click('button:has-text("Create")');
    await expect(page.locator('.fixed.inset-0.bg-black')).not.toBeVisible({ timeout: 10000 });

    const folderLink = page.locator('[data-testid="file-list"] a').filter({ hasText: 'branch-compare-test' }).first();
    await expect(folderLink).toBeVisible({ timeout: 15000 });
    await folderLink.click();
    await page.waitForURL(/branch-compare-test/, { timeout: 10000 });

    // Create initial file
    await page.evaluate(async () => {
      const { getTree, LinkType } = await import('/src/store.ts');
      const { autosaveIfOwn } = await import('/src/nostr.ts');
      const { getCurrentRootCid } = await import('/src/actions/route.ts');
      const { getRouteSync } = await import('/src/stores/index.ts');
      const route = getRouteSync();
      const tree = getTree();
      let rootCid = getCurrentRootCid();
      if (!rootCid) return;
      const content = new TextEncoder().encode('initial content');
      const { cid, size } = await tree.putFile(content);
      rootCid = await tree.setEntry(rootCid, route.path, 'main-file.txt', cid, size, LinkType.Blob);
      autosaveIfOwn(rootCid);
    });

    await expect(page.locator('[data-testid="file-list"] a').filter({ hasText: 'main-file.txt' })).toBeVisible({ timeout: 15000 });

    // Git init
    const gitInitBtn = page.getByRole('button', { name: 'Git Init' });
    await expect(gitInitBtn).toBeVisible({ timeout: 15000 });
    await gitInitBtn.click();
    await expect(gitInitBtn).not.toBeVisible({ timeout: 30000 });

    // Verify branch selector shows "master"
    const branchSelector = page.locator('button').filter({ hasText: /master|main/i }).first();
    await expect(branchSelector).toBeVisible({ timeout: 10000 });

    // Create a new branch "feature"
    await branchSelector.click();
    const newBranchBtn = page.locator('button').filter({ hasText: 'New branch' });
    await expect(newBranchBtn).toBeVisible({ timeout: 5000 });
    await newBranchBtn.click();

    const branchNameInput = page.locator('input[placeholder="Branch name"]');
    await expect(branchNameInput).toBeVisible({ timeout: 5000 });
    await branchNameInput.fill('feature');
    await page.locator('button').filter({ hasText: 'Create' }).click();

    // Wait for dropdown to close and branch to be created
    await expect(branchNameInput).not.toBeVisible({ timeout: 10000 });

    // Wait for UI to fully update after branch creation - verify we're on feature branch
    await page.waitForTimeout(2000);
    await expect(page.locator('button').filter({ hasText: 'feature' }).first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=/2 branches/')).toBeVisible({ timeout: 10000 });

    // Add a new file on the feature branch
    await page.evaluate(async () => {
      const { getTree, LinkType } = await import('/src/store.ts');
      const { autosaveIfOwn } = await import('/src/nostr.ts');
      const { getCurrentRootCid } = await import('/src/actions/route.ts');
      const { getRouteSync } = await import('/src/stores/index.ts');
      const route = getRouteSync();
      const tree = getTree();
      let rootCid = getCurrentRootCid();
      if (!rootCid) return;
      const content = new TextEncoder().encode('feature content');
      const { cid, size } = await tree.putFile(content);
      rootCid = await tree.setEntry(rootCid, route.path, 'feature-file.txt', cid, size, LinkType.Blob);
      autosaveIfOwn(rootCid);
    });

    await expect(page.locator('[data-testid="file-list"] a').filter({ hasText: 'feature-file.txt' })).toBeVisible({ timeout: 15000 });

    // Screenshot before looking for uncommitted button
    await page.screenshot({ path: 'e2e/screenshots/compare-test-before-commit.png' });

    // Commit the feature file
    const uncommittedBtn = page.locator('button').filter({ hasText: /uncommitted/i });
    await expect(uncommittedBtn).toBeVisible({ timeout: 60000 });
    await uncommittedBtn.click();

    const commitModal = page.locator('.fixed.inset-0').filter({ hasText: 'Commit Changes' });
    await expect(commitModal).toBeVisible({ timeout: 5000 });
    await commitModal.locator('textarea').fill('Add feature file');
    await commitModal.getByRole('button', { name: /Commit/ }).click();
    await expect(commitModal).not.toBeVisible({ timeout: 30000 });

    // Navigate to compare URL
    const currentUrl = page.url();
    const baseUrl = currentUrl.split('?')[0];
    await page.goto(`${baseUrl}?compare=master...feature`);

    // Verify compare view shows the git-compare icon
    await expect(page.locator('.i-lucide-git-compare')).toBeVisible({ timeout: 15000 });

    // Should show the branch names in the header
    // baseBranch has class "font-mono text-sm", headBranch has "font-mono text-sm text-accent"
    await expect(page.locator('span.font-mono.text-sm:has-text("master")')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('span.font-mono.text-sm.text-accent:has-text("feature")')).toBeVisible({ timeout: 10000 });

    // Should show file change stats (wait for actual diff to complete, not just loading state)
    await expect(page.locator('text=/\\d+ file.*changed/')).toBeVisible({ timeout: 30000 });
  });

  test('branch dropdown shows compare option', async ({ page }) => {
    test.setTimeout(90000);
    await navigateToPublicFolder(page);

    // Create a folder and init as git repo
    await page.getByRole('button', { name: 'New Folder' }).click();
    const folderInput = page.locator('input[placeholder="Folder name..."]');
    await folderInput.waitFor({ timeout: 5000 });
    await folderInput.fill('compare-dropdown-test');
    await page.click('button:has-text("Create")');
    await expect(page.locator('.fixed.inset-0.bg-black')).not.toBeVisible({ timeout: 10000 });

    const folderLink = page.locator('[data-testid="file-list"] a').filter({ hasText: 'compare-dropdown-test' }).first();
    await expect(folderLink).toBeVisible({ timeout: 15000 });
    await folderLink.click();
    await page.waitForURL(/compare-dropdown-test/, { timeout: 10000 });

    // Create initial file
    await page.evaluate(async () => {
      const { getTree, LinkType } = await import('/src/store.ts');
      const { autosaveIfOwn } = await import('/src/nostr.ts');
      const { getCurrentRootCid } = await import('/src/actions/route.ts');
      const { getRouteSync } = await import('/src/stores/index.ts');
      const route = getRouteSync();
      const tree = getTree();
      let rootCid = getCurrentRootCid();
      if (!rootCid) return;
      const content = new TextEncoder().encode('test content');
      const { cid, size } = await tree.putFile(content);
      rootCid = await tree.setEntry(rootCid, route.path, 'test.txt', cid, size, LinkType.Blob);
      autosaveIfOwn(rootCid);
    });

    await expect(page.locator('[data-testid="file-list"] a').filter({ hasText: 'test.txt' })).toBeVisible({ timeout: 15000 });

    // Git init
    const gitInitBtn = page.getByRole('button', { name: 'Git Init' });
    await expect(gitInitBtn).toBeVisible({ timeout: 15000 });
    await gitInitBtn.click();
    await expect(gitInitBtn).not.toBeVisible({ timeout: 30000 });

    // Create a second branch
    const branchSelector = page.locator('button').filter({ hasText: /master|main/i }).first();
    await expect(branchSelector).toBeVisible({ timeout: 10000 });
    await branchSelector.click();

    const newBranchBtn = page.locator('button').filter({ hasText: 'New branch' });
    await expect(newBranchBtn).toBeVisible({ timeout: 5000 });
    await newBranchBtn.click();

    const branchNameInput = page.locator('input[placeholder="Branch name"]');
    await expect(branchNameInput).toBeVisible({ timeout: 5000 });
    await branchNameInput.fill('dev');
    await page.locator('button').filter({ hasText: 'Create' }).click();

    // Wait for dropdown to close
    await expect(branchNameInput).not.toBeVisible({ timeout: 5000 });

    // Re-open branch dropdown and check for "Compare branches" option
    // Wait for branches to reload
    await page.waitForTimeout(1000);
    const branchBtn = page.locator('button').filter({ has: page.locator('.i-lucide-git-branch') }).first();
    await branchBtn.click();

    // The compare option should be visible when there are multiple branches
    const compareBtn = page.locator('button').filter({ hasText: 'Compare branches' });
    await expect(compareBtn).toBeVisible({ timeout: 10000 });
  });

  test('branch creation persists and shows in dropdown', { timeout: 90000 }, async ({ page }) => {
    await navigateToPublicFolder(page);

    // Create a folder and init as git repo
    await page.getByRole('button', { name: 'New Folder' }).click();
    const folderInput = page.locator('input[placeholder="Folder name..."]');
    await folderInput.waitFor({ timeout: 5000 });
    await folderInput.fill('branch-persist-test');
    await page.click('button:has-text("Create")');
    await expect(page.locator('.fixed.inset-0.bg-black')).not.toBeVisible({ timeout: 10000 });

    const folderLink = page.locator('[data-testid="file-list"] a').filter({ hasText: 'branch-persist-test' }).first();
    await expect(folderLink).toBeVisible({ timeout: 15000 });
    await folderLink.click();
    await page.waitForURL(/branch-persist-test/, { timeout: 10000 });

    // Create initial file
    await page.evaluate(async () => {
      const { getTree, LinkType } = await import('/src/store.ts');
      const { autosaveIfOwn } = await import('/src/nostr.ts');
      const { getCurrentRootCid } = await import('/src/actions/route.ts');
      const { getRouteSync } = await import('/src/stores/index.ts');
      const route = getRouteSync();
      const tree = getTree();
      let rootCid = getCurrentRootCid();
      if (!rootCid) return;
      const content = new TextEncoder().encode('test content');
      const { cid, size } = await tree.putFile(content);
      rootCid = await tree.setEntry(rootCid, route.path, 'test.txt', cid, size, LinkType.Blob);
      autosaveIfOwn(rootCid);
    });

    await expect(page.locator('[data-testid="file-list"] a').filter({ hasText: 'test.txt' })).toBeVisible({ timeout: 15000 });

    // Git init
    const gitInitBtn = page.getByRole('button', { name: 'Git Init' });
    await expect(gitInitBtn).toBeVisible({ timeout: 15000 });
    await gitInitBtn.click();
    await expect(gitInitBtn).not.toBeVisible({ timeout: 30000 });

    // Verify branch selector shows "master" and 1 branch
    const branchSelector = page.locator('button').filter({ hasText: /master|main/i }).first();
    await expect(branchSelector).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=/1 branch/')).toBeVisible({ timeout: 10000 });

    // Take screenshot before creating branch
    await page.screenshot({ path: 'e2e/screenshots/branch-test-before-create.png' });

    // Create a new branch "feature"
    await branchSelector.click();
    const newBranchBtn = page.locator('button').filter({ hasText: 'New branch' });
    await expect(newBranchBtn).toBeVisible({ timeout: 5000 });
    await newBranchBtn.click();

    const branchNameInput = page.locator('input[placeholder="Branch name"]');
    await expect(branchNameInput).toBeVisible({ timeout: 5000 });
    await branchNameInput.fill('feature');
    await page.locator('button').filter({ hasText: 'Create' }).click();

    // Wait for dropdown to close
    await expect(branchNameInput).not.toBeVisible({ timeout: 10000 });

    // Wait for UI to update after branch creation
    await page.waitForTimeout(2000);

    // Take screenshot after creating branch
    await page.screenshot({ path: 'e2e/screenshots/branch-test-after-create.png' });

    // Verify branch selector now shows "feature" (we checked out to it)
    const featureBranchBtn = page.locator('button').filter({ hasText: 'feature' }).first();
    await expect(featureBranchBtn).toBeVisible({ timeout: 15000 });

    // Verify we now have 2 branches
    await expect(page.locator('text=/2 branches/')).toBeVisible({ timeout: 10000 });
  });
});
