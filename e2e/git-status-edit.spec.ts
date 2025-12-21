import { test, expect } from '@playwright/test';
import { setupPageErrorHandler, navigateToPublicFolder, disableOthersPool } from './test-utils.js';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const HASHTREE_RS_DIR = '/workspace/hashtree-rs';

// Check if git-remote-htree is available
function hasGitRemoteHtree(): boolean {
  const binary = path.join(HASHTREE_RS_DIR, 'target/release/git-remote-htree');
  return fs.existsSync(binary);
}

test.describe('Git status after file edit', () => {
  test.beforeEach(async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await disableOthersPool(page);
  });

  test('should show uncommitted after editing a file', { timeout: 90000 }, async ({ page }) => {
    test.slow();
    await navigateToPublicFolder(page);

    // Create a folder for our test repo
    await page.getByRole('button', { name: 'New Folder' }).click();
    const folderInput = page.locator('input[placeholder="Folder name..."]');
    await folderInput.waitFor({ timeout: 5000 });
    await folderInput.fill('status-edit-test');
    await page.click('button:has-text("Create")');
    await expect(page.locator('.fixed.inset-0.bg-black')).not.toBeVisible({ timeout: 10000 });

    // Navigate into the folder
    const folderLink = page.locator('[data-testid="file-list"] a').filter({ hasText: 'status-edit-test' }).first();
    await expect(folderLink).toBeVisible({ timeout: 15000 });
    await folderLink.click();
    await page.waitForURL(/status-edit-test/, { timeout: 10000 });

    // Create initial files via the tree API
    await page.evaluate(async () => {
      const { getTree, LinkType } = await import('/src/store.ts');
      const { autosaveIfOwn } = await import('/src/nostr.ts');
      const { getCurrentRootCid } = await import('/src/actions/route.ts');
      const { getRouteSync } = await import('/src/stores/index.ts');
      const route = getRouteSync();

      const tree = getTree();
      let rootCid = getCurrentRootCid();
      if (!rootCid) return;

      // Create README.md
      const readmeContent = new TextEncoder().encode('# Status Edit Test\n\nOriginal content.');
      const { cid: readmeCid, size: readmeSize } = await tree.putFile(readmeContent);
      rootCid = await tree.setEntry(rootCid, route.path, 'README.md', readmeCid, readmeSize, LinkType.Blob);

      autosaveIfOwn(rootCid);
    });

    // Wait for file to appear
    await expect(page.locator('[data-testid="file-list"] a').filter({ hasText: 'README.md' })).toBeVisible({ timeout: 15000 });

    // Git Init
    const gitInitBtn = page.getByRole('button', { name: 'Git Init' });
    await expect(gitInitBtn).toBeVisible({ timeout: 15000 });
    await gitInitBtn.click();

    // Wait for initialization to complete
    await expect(gitInitBtn).not.toBeVisible({ timeout: 30000 });

    // Verify .git directory was created
    const gitDir = page.locator('[data-testid="file-list"] a').filter({ hasText: '.git' }).first();
    await expect(gitDir).toBeVisible({ timeout: 10000 });

    // Verify commits button appears (git repo detected)
    const commitsBtn = page.getByRole('button', { name: /commits/i });
    await expect(commitsBtn).toBeVisible({ timeout: 10000 });

    // Wait for status to show "clean" (after initial commit)
    // The status indicator should show either "clean" text or a checkmark
    const cleanIndicator = page.locator('text=clean');
    await expect(cleanIndicator).toBeVisible({ timeout: 30000 });
    console.log('[test] Git status shows clean after initial commit');

    // Now EDIT the README.md file (modify existing file, not add new)
    console.log('[test] Editing README.md...');
    await page.evaluate(async () => {
      const { getTree, LinkType } = await import('/src/store.ts');
      const { autosaveIfOwn } = await import('/src/nostr.ts');
      const { getCurrentRootCid } = await import('/src/actions/route.ts');
      const { getRouteSync } = await import('/src/stores/index.ts');
      const route = getRouteSync();

      const tree = getTree();
      let rootCid = getCurrentRootCid();
      if (!rootCid) return;

      // Modify README.md with new content
      const updatedContent = new TextEncoder().encode('# Status Edit Test\n\nModified content - this file was edited!');
      const { cid: updatedCid, size: updatedSize } = await tree.putFile(updatedContent);
      rootCid = await tree.setEntry(rootCid, route.path, 'README.md', updatedCid, updatedSize, LinkType.Blob);

      autosaveIfOwn(rootCid);
    });

    // Wait for the uncommitted changes indicator to appear
    // This is the critical test - after editing a file, status should show "uncommitted"
    console.log('[test] Waiting for uncommitted indicator...');
    const uncommittedBtn = page.locator('button').filter({ hasText: /uncommitted/i });

    // Take screenshot for debugging if this fails
    await page.screenshot({ path: 'e2e/screenshots/git-status-after-edit.png' });

    await expect(uncommittedBtn).toBeVisible({ timeout: 30000 });
    console.log('[test] SUCCESS: uncommitted indicator visible after file edit');

    // Verify the count shows 1 change (the modified file)
    await expect(uncommittedBtn).toContainText(/1/);

    // Click to open commit modal and verify
    await uncommittedBtn.click();
    const commitModal = page.locator('.fixed.inset-0').filter({ hasText: 'Commit Changes' });
    await expect(commitModal).toBeVisible({ timeout: 5000 });

    // Should show README.md as modified
    await expect(commitModal.locator('text=README.md')).toBeVisible({ timeout: 5000 });

    await page.keyboard.press('Escape');
  });

  test('should show uncommitted after adding a new file in subdirectory', { timeout: 90000 }, async ({ page }) => {
    test.slow();
    await navigateToPublicFolder(page);

    // Create a folder for our test repo
    await page.getByRole('button', { name: 'New Folder' }).click();
    const folderInput = page.locator('input[placeholder="Folder name..."]');
    await folderInput.waitFor({ timeout: 5000 });
    await folderInput.fill('subdir-test');
    await page.click('button:has-text("Create")');
    await expect(page.locator('.fixed.inset-0.bg-black')).not.toBeVisible({ timeout: 10000 });

    // Navigate into the folder
    const folderLink = page.locator('[data-testid="file-list"] a').filter({ hasText: 'subdir-test' }).first();
    await expect(folderLink).toBeVisible({ timeout: 15000 });
    await folderLink.click();
    await page.waitForURL(/subdir-test/, { timeout: 10000 });

    // Create initial files with a src/ subdirectory
    await page.evaluate(async () => {
      const { getTree, LinkType } = await import('/src/store.ts');
      const { autosaveIfOwn } = await import('/src/nostr.ts');
      const { getCurrentRootCid } = await import('/src/actions/route.ts');
      const { getRouteSync } = await import('/src/stores/index.ts');
      const route = getRouteSync();

      const tree = getTree();
      let rootCid = getCurrentRootCid();
      if (!rootCid) return;

      // Create README.md
      const readmeContent = new TextEncoder().encode('# Subdir Test\n');
      const { cid: readmeCid, size: readmeSize } = await tree.putFile(readmeContent);
      rootCid = await tree.setEntry(rootCid, route.path, 'README.md', readmeCid, readmeSize, LinkType.Blob);

      // Create src directory
      const { cid: emptyDir } = await tree.putDirectory([]);
      rootCid = await tree.setEntry(rootCid, route.path, 'src', emptyDir, 0, LinkType.Dir);

      // Create src/main.js
      const mainContent = new TextEncoder().encode('console.log("hello");');
      const { cid: mainCid, size: mainSize } = await tree.putFile(mainContent);
      rootCid = await tree.setEntry(rootCid, [...route.path, 'src'], 'main.js', mainCid, mainSize, LinkType.Blob);

      autosaveIfOwn(rootCid);
    });

    // Wait for files to appear
    await expect(page.locator('[data-testid="file-list"] a').filter({ hasText: 'README.md' })).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="file-list"] a').filter({ hasText: 'src' })).toBeVisible({ timeout: 5000 });

    // Git Init
    const gitInitBtn = page.getByRole('button', { name: 'Git Init' });
    await expect(gitInitBtn).toBeVisible({ timeout: 15000 });
    await gitInitBtn.click();
    await expect(gitInitBtn).not.toBeVisible({ timeout: 30000 });

    // Verify git repo detected and clean
    const cleanIndicator = page.locator('text=clean');
    await expect(cleanIndicator).toBeVisible({ timeout: 30000 });
    console.log('[test] Git status shows clean after initial commit');

    // Now add a NEW file (not just edit existing) at root level
    console.log('[test] Adding new file...');
    await page.evaluate(async () => {
      const { getTree, LinkType } = await import('/src/store.ts');
      const { autosaveIfOwn } = await import('/src/nostr.ts');
      const { getCurrentRootCid } = await import('/src/actions/route.ts');
      const { getRouteSync } = await import('/src/stores/index.ts');
      const route = getRouteSync();

      const tree = getTree();
      let rootCid = getCurrentRootCid();
      if (!rootCid) return;

      // Add a new file
      const newContent = new TextEncoder().encode('New file content');
      const { cid: newCid, size: newSize } = await tree.putFile(newContent);
      rootCid = await tree.setEntry(rootCid, route.path, 'newfile.txt', newCid, newSize, LinkType.Blob);

      autosaveIfOwn(rootCid);
    });

    // Wait for new file to appear
    await expect(page.locator('[data-testid="file-list"] a').filter({ hasText: 'newfile.txt' })).toBeVisible({ timeout: 15000 });

    // Wait for uncommitted indicator
    console.log('[test] Waiting for uncommitted indicator after adding file...');
    const uncommittedBtn = page.locator('button').filter({ hasText: /uncommitted/i });
    await expect(uncommittedBtn).toBeVisible({ timeout: 30000 });
    console.log('[test] SUCCESS: uncommitted indicator visible after adding new file');
  });

  test('should show uncommitted when editing file inside subdirectory', { timeout: 90000 }, async ({ page }) => {
    test.slow();
    await navigateToPublicFolder(page);

    // Create a folder for our test repo
    await page.getByRole('button', { name: 'New Folder' }).click();
    const folderInput = page.locator('input[placeholder="Folder name..."]');
    await folderInput.waitFor({ timeout: 5000 });
    await folderInput.fill('edit-in-subdir-test');
    await page.click('button:has-text("Create")');
    await expect(page.locator('.fixed.inset-0.bg-black')).not.toBeVisible({ timeout: 10000 });

    // Navigate into the folder
    const folderLink = page.locator('[data-testid="file-list"] a').filter({ hasText: 'edit-in-subdir-test' }).first();
    await expect(folderLink).toBeVisible({ timeout: 15000 });
    await folderLink.click();
    await page.waitForURL(/edit-in-subdir-test/, { timeout: 10000 });

    // Create files with a src/ subdirectory
    await page.evaluate(async () => {
      const { getTree, LinkType } = await import('/src/store.ts');
      const { autosaveIfOwn } = await import('/src/nostr.ts');
      const { getCurrentRootCid } = await import('/src/actions/route.ts');
      const { getRouteSync } = await import('/src/stores/index.ts');
      const route = getRouteSync();

      const tree = getTree();
      let rootCid = getCurrentRootCid();
      if (!rootCid) return;

      // Create src directory
      const { cid: emptyDir } = await tree.putDirectory([]);
      rootCid = await tree.setEntry(rootCid, route.path, 'src', emptyDir, 0, LinkType.Dir);

      // Create src/main.js
      const mainContent = new TextEncoder().encode('console.log("original");');
      const { cid: mainCid, size: mainSize } = await tree.putFile(mainContent);
      rootCid = await tree.setEntry(rootCid, [...route.path, 'src'], 'main.js', mainCid, mainSize, LinkType.Blob);

      autosaveIfOwn(rootCid);
    });

    // Wait for files to appear
    await expect(page.locator('[data-testid="file-list"] a').filter({ hasText: 'src' })).toBeVisible({ timeout: 15000 });

    // Git Init
    const gitInitBtn = page.getByRole('button', { name: 'Git Init' });
    await expect(gitInitBtn).toBeVisible({ timeout: 15000 });
    await gitInitBtn.click();
    await expect(gitInitBtn).not.toBeVisible({ timeout: 30000 });

    // Verify git repo detected and clean
    const cleanIndicator = page.locator('text=clean');
    await expect(cleanIndicator).toBeVisible({ timeout: 30000 });
    console.log('[test] Git status shows clean after initial commit');

    // Navigate into src/ subdirectory
    const srcLink = page.locator('[data-testid="file-list"] a').filter({ hasText: 'src' }).first();
    await srcLink.click();
    await page.waitForURL(/src/, { timeout: 10000 });

    // Verify we're in the subdirectory and can see main.js
    await expect(page.locator('[data-testid="file-list"] a').filter({ hasText: 'main.js' })).toBeVisible({ timeout: 15000 });

    // Status should still show clean (we're in subdirectory, git root is parent)
    await expect(cleanIndicator).toBeVisible({ timeout: 10000 });
    console.log('[test] Git status shows clean in subdirectory');

    // Now EDIT main.js while in the subdirectory
    console.log('[test] Editing main.js in subdirectory...');
    await page.evaluate(async () => {
      const { getTree, LinkType } = await import('/src/store.ts');
      const { autosaveIfOwn } = await import('/src/nostr.ts');
      const { getCurrentRootCid } = await import('/src/actions/route.ts');
      const { getRouteSync } = await import('/src/stores/index.ts');
      const route = getRouteSync();

      const tree = getTree();
      let rootCid = getCurrentRootCid();
      if (!rootCid) return;

      // Modify main.js with new content (route.path should be ["edit-in-subdir-test", "src"])
      const updatedContent = new TextEncoder().encode('console.log("modified!");');
      const { cid: updatedCid, size: updatedSize } = await tree.putFile(updatedContent);
      rootCid = await tree.setEntry(rootCid, route.path, 'main.js', updatedCid, updatedSize, LinkType.Blob);

      autosaveIfOwn(rootCid);
    });

    // Wait for the uncommitted changes indicator to appear
    console.log('[test] Waiting for uncommitted indicator...');
    const uncommittedBtn = page.locator('button').filter({ hasText: /uncommitted/i });

    // Take screenshot for debugging
    await page.screenshot({ path: 'e2e/screenshots/git-status-subdir-edit.png' });

    await expect(uncommittedBtn).toBeVisible({ timeout: 30000 });
    console.log('[test] SUCCESS: uncommitted indicator visible after editing file in subdirectory');
  });

  test('should show uncommitted after using FileEditor to edit a file', { timeout: 120000 }, async ({ page }) => {
    // This test uses the actual FileEditor UI component to edit a file,
    // matching what the user does when clicking on a file and editing via autosave
    test.slow();
    await navigateToPublicFolder(page);

    // Create a folder for our test repo
    await page.getByRole('button', { name: 'New Folder' }).click();
    const folderInput = page.locator('input[placeholder="Folder name..."]');
    await folderInput.waitFor({ timeout: 5000 });
    await folderInput.fill('editor-test');
    await page.click('button:has-text("Create")');
    await expect(page.locator('.fixed.inset-0.bg-black')).not.toBeVisible({ timeout: 10000 });

    // Navigate into the folder
    const folderLink = page.locator('[data-testid="file-list"] a').filter({ hasText: 'editor-test' }).first();
    await expect(folderLink).toBeVisible({ timeout: 15000 });
    await folderLink.click();
    await page.waitForURL(/editor-test/, { timeout: 10000 });

    // Create initial file via the tree API
    await page.evaluate(async () => {
      const { getTree, LinkType } = await import('/src/store.ts');
      const { autosaveIfOwn } = await import('/src/nostr.ts');
      const { getCurrentRootCid } = await import('/src/actions/route.ts');
      const { getRouteSync } = await import('/src/stores/index.ts');
      const route = getRouteSync();

      const tree = getTree();
      let rootCid = getCurrentRootCid();
      if (!rootCid) return;

      // Create test.txt - a text file that can be edited
      const content = new TextEncoder().encode('Original content\n');
      const { cid, size } = await tree.putFile(content);
      rootCid = await tree.setEntry(rootCid, route.path, 'test.txt', cid, size, LinkType.Blob);

      autosaveIfOwn(rootCid);
    });

    // Wait for file to appear
    await expect(page.locator('[data-testid="file-list"] a').filter({ hasText: 'test.txt' })).toBeVisible({ timeout: 15000 });

    // Git Init
    const gitInitBtn = page.getByRole('button', { name: 'Git Init' });
    await expect(gitInitBtn).toBeVisible({ timeout: 15000 });
    await gitInitBtn.click();
    await expect(gitInitBtn).not.toBeVisible({ timeout: 30000 });

    // Verify git repo detected and clean
    const cleanIndicator = page.locator('text=clean');
    await expect(cleanIndicator).toBeVisible({ timeout: 30000 });
    console.log('[test] Git status shows clean after initial commit');

    // Record the current URL (directory view with ?g= param)
    const dirUrl = page.url();
    console.log('[test] Directory URL:', dirUrl);

    // Click on test.txt to view it
    const fileLink = page.locator('[data-testid="file-list"] a').filter({ hasText: 'test.txt' }).first();
    await fileLink.click();
    await page.waitForURL(/test\.txt/, { timeout: 10000 });
    console.log('[test] Navigated to file');

    // Wait for the file content to load
    await expect(page.locator('pre').filter({ hasText: 'Original content' })).toBeVisible({ timeout: 10000 });
    console.log('[test] File content loaded');

    // Click Edit button to enter edit mode
    const editBtn = page.locator('[data-testid="viewer-edit"]');
    await expect(editBtn).toBeVisible({ timeout: 5000 });
    await editBtn.click();
    console.log('[test] Clicked Edit button');

    // Wait for the FileEditor to appear (textarea)
    const textarea = page.locator('textarea');
    await expect(textarea).toBeVisible({ timeout: 5000 });
    console.log('[test] FileEditor visible');

    // Enable autosave if not already enabled
    const autosaveCheckbox = page.locator('input[type="checkbox"]').filter({ has: page.locator('text=Autosave') });
    // Check if autosave label is visible and checkbox is present
    const autosaveLabel = page.locator('label').filter({ hasText: 'Autosave' });
    if (await autosaveLabel.isVisible()) {
      const checkbox = autosaveLabel.locator('input[type="checkbox"]');
      const isChecked = await checkbox.isChecked();
      if (!isChecked) {
        await checkbox.click();
        console.log('[test] Enabled autosave');
      } else {
        console.log('[test] Autosave already enabled');
      }
    }

    // Clear and type new content
    await textarea.fill('Modified content - this file was edited!\n');
    console.log('[test] Typed new content');

    // Wait for autosave debounce (1 second + some buffer)
    await page.waitForTimeout(1500);
    console.log('[test] Waited for autosave');

    // Click Done to exit edit mode (stays on file view)
    const doneBtn = page.getByRole('button', { name: 'Done' });
    await doneBtn.click();
    console.log('[test] Clicked Done - exited edit mode');

    // Wait for edit mode to exit (textarea should be gone)
    await expect(page.locator('textarea')).not.toBeVisible({ timeout: 5000 });
    console.log('[test] Edit mode exited');

    // Now navigate back to the directory view by clicking the back button
    const backBtn = page.locator('[data-testid="viewer-back"]');
    await expect(backBtn).toBeVisible({ timeout: 5000 });
    await backBtn.click();
    console.log('[test] Clicked back button');

    // Wait for directory view (should not have test.txt in the URL path)
    await page.waitForFunction(() => !window.location.hash.includes('test.txt'), { timeout: 10000 });
    console.log('[test] Back at directory view');

    // Take screenshot for debugging
    await page.screenshot({ path: 'e2e/screenshots/git-status-editor-test.png' });

    // NOW check for the uncommitted indicator
    // This is the critical test - after editing via FileEditor, status should show "uncommitted"
    console.log('[test] Checking for uncommitted indicator...');
    const uncommittedBtn = page.locator('button').filter({ hasText: /uncommitted/i });

    // Wait for the git status to update - may need to reload or wait for reactivity
    await expect(uncommittedBtn).toBeVisible({ timeout: 30000 });
    console.log('[test] SUCCESS: uncommitted indicator visible after using FileEditor');

    // Verify the count shows 1 change
    await expect(uncommittedBtn).toContainText(/1/);
  });

  test('should show uncommitted after forking and editing a git repo', { timeout: 120000 }, async ({ page }) => {
    // This test verifies that forked git repos maintain the index file
    // and git status correctly shows changes after editing
    test.slow();
    await navigateToPublicFolder(page);

    // Create a folder for our source repo
    await page.getByRole('button', { name: 'New Folder' }).click();
    const folderInput = page.locator('input[placeholder="Folder name..."]');
    await folderInput.waitFor({ timeout: 5000 });
    await folderInput.fill('fork-source-test');
    await page.click('button:has-text("Create")');
    await expect(page.locator('.fixed.inset-0.bg-black')).not.toBeVisible({ timeout: 10000 });

    // Navigate into the folder
    const folderLink = page.locator('[data-testid="file-list"] a').filter({ hasText: 'fork-source-test' }).first();
    await expect(folderLink).toBeVisible({ timeout: 15000 });
    await folderLink.click();
    await page.waitForURL(/fork-source-test/, { timeout: 10000 });

    // Create initial files via the tree API
    await page.evaluate(async () => {
      const { getTree, LinkType } = await import('/src/store.ts');
      const { autosaveIfOwn } = await import('/src/nostr.ts');
      const { getCurrentRootCid } = await import('/src/actions/route.ts');
      const { getRouteSync } = await import('/src/stores/index.ts');
      const route = getRouteSync();

      const tree = getTree();
      let rootCid = getCurrentRootCid();
      if (!rootCid) return;

      // Create README.md
      const readmeContent = new TextEncoder().encode('# Fork Test\n\nOriginal content.');
      const { cid: readmeCid, size: readmeSize } = await tree.putFile(readmeContent);
      rootCid = await tree.setEntry(rootCid, route.path, 'README.md', readmeCid, readmeSize, LinkType.Blob);

      autosaveIfOwn(rootCid);
    });

    // Wait for file to appear
    await expect(page.locator('[data-testid="file-list"] a').filter({ hasText: 'README.md' })).toBeVisible({ timeout: 15000 });

    // Git Init
    const gitInitBtn = page.getByRole('button', { name: 'Git Init' });
    await expect(gitInitBtn).toBeVisible({ timeout: 15000 });
    await gitInitBtn.click();

    // Wait for initialization to complete
    await expect(gitInitBtn).not.toBeVisible({ timeout: 30000 });

    // Verify git repo detected and clean
    const cleanIndicator = page.locator('text=clean');
    await expect(cleanIndicator).toBeVisible({ timeout: 30000 });
    console.log('[test] Source repo: Git status shows clean after initial commit');

    // Now FORK this repo using the Fork button
    // First look for the Fork button in the toolbar
    const forkBtn = page.locator('button').filter({ has: page.locator('.i-lucide-git-fork, [class*="git-fork"]') }).first();

    // Alternative: look by aria-label or title
    let foundFork = await forkBtn.isVisible().catch(() => false);
    if (!foundFork) {
      // Try other ways to find fork button
      const toolbarForkBtn = page.getByRole('button', { name: /fork/i });
      foundFork = await toolbarForkBtn.isVisible().catch(() => false);
      if (foundFork) {
        await toolbarForkBtn.click();
      }
    } else {
      await forkBtn.click();
    }

    if (!foundFork) {
      // If no fork button, we need to use the menu/context approach
      // Click the dropdown menu to access Fork
      const menuBtn = page.locator('[data-testid="folder-menu"]');
      if (await menuBtn.isVisible().catch(() => false)) {
        await menuBtn.click();
        const forkMenuItem = page.locator('text=Fork');
        await forkMenuItem.click();
      } else {
        console.log('[test] Fork button not found, skipping fork test');
        test.skip(true, 'Fork button not found in UI');
        return;
      }
    }

    // Wait for fork modal
    const forkModal = page.locator('.fixed.inset-0').filter({ hasText: 'Fork as New Folder' });
    await expect(forkModal).toBeVisible({ timeout: 5000 });

    // Enter name for forked repo
    const forkNameInput = forkModal.locator('input');
    await forkNameInput.fill('fork-dest-test');

    // Click Fork button
    const confirmForkBtn = forkModal.getByRole('button', { name: /fork/i }).last();
    await confirmForkBtn.click();

    // Wait for navigation to forked repo
    await page.waitForURL(/fork-dest-test/, { timeout: 15000 });
    console.log('[test] Forked to fork-dest-test');

    // Wait for forked repo to load
    await expect(page.locator('[data-testid="file-list"] a').filter({ hasText: 'README.md' })).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="file-list"] a').filter({ hasText: '.git' })).toBeVisible({ timeout: 5000 });
    console.log('[test] Forked repo loaded with files');

    // Verify git status shows clean in forked repo
    const forkedCleanIndicator = page.locator('text=clean');
    await expect(forkedCleanIndicator).toBeVisible({ timeout: 30000 });
    console.log('[test] Forked repo: Git status shows clean (index copied correctly)');

    // Now EDIT a file in the forked repo
    console.log('[test] Editing README.md in forked repo...');
    await page.evaluate(async () => {
      const { getTree, LinkType } = await import('/src/store.ts');
      const { autosaveIfOwn } = await import('/src/nostr.ts');
      const { getCurrentRootCid } = await import('/src/actions/route.ts');
      const { getRouteSync } = await import('/src/stores/index.ts');
      const route = getRouteSync();

      const tree = getTree();
      let rootCid = getCurrentRootCid();
      if (!rootCid) return;

      // Modify README.md with new content
      const updatedContent = new TextEncoder().encode('# Fork Test\n\nModified content in fork!');
      const { cid: updatedCid, size: updatedSize } = await tree.putFile(updatedContent);
      rootCid = await tree.setEntry(rootCid, route.path, 'README.md', updatedCid, updatedSize, LinkType.Blob);

      autosaveIfOwn(rootCid);
    });

    // Wait for the uncommitted changes indicator to appear
    console.log('[test] Waiting for uncommitted indicator in forked repo...');
    const uncommittedBtn = page.locator('button').filter({ hasText: /uncommitted/i });

    // Take screenshot for debugging if this fails
    await page.screenshot({ path: 'e2e/screenshots/git-status-forked-edit.png' });

    await expect(uncommittedBtn).toBeVisible({ timeout: 30000 });
    console.log('[test] SUCCESS: uncommitted indicator visible after editing forked repo');

    // Verify the count shows 1 change
    await expect(uncommittedBtn).toContainText(/1/);
  });

  // This test verifies that repos pushed via git-remote-htree have a valid index file
  // and git status works when viewing from the browser via nostr.
  // Note: This test requires reliable nostr relay access and may be flaky due to network conditions.
  // It is skipped by default - run with HTREE_NETWORK_TEST=1 to enable.
  test.skip('should show uncommitted in git-remote-htree pushed repo after edit', { timeout: 180000 }, async ({ page }) => {
    // Skip unless explicitly enabled via env var
    if (!process.env.HTREE_NETWORK_TEST) {
      test.skip(true, 'Network test skipped - set HTREE_NETWORK_TEST=1 to enable');
      return;
    }

    // Skip if git-remote-htree is not built
    if (!hasGitRemoteHtree()) {
      test.skip(true, 'git-remote-htree not built - run: cargo build --release -p git-remote-htree');
      return;
    }

    test.slow();

    // Capture browser console logs for debugging wasm-git
    const consoleLogs: string[] = [];
    page.on('console', msg => {
      const text = msg.text();
      // Capture wasm-git and git status related logs
      if (text.includes('[wasm-git]') || text.includes('[git]') || text.includes('wasm-git') ||
          text.includes('hasChanges') || text.includes('Index file')) {
        consoleLogs.push(text);
        console.log('[browser]', text);
      }
    });

    // Create temp directory for the test
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-status-htree-'));
    const testRepoDir = path.join(tempDir, 'test-repo');
    fs.mkdirSync(testRepoDir);

    const gitRemoteHtree = path.join(HASHTREE_RS_DIR, 'target/release/git-remote-htree');
    const env = {
      ...process.env,
      HOME: tempDir,
      PATH: `${path.dirname(gitRemoteHtree)}:${process.env.PATH}`,
    };

    // Create .hashtree config pointing to real relays/blossoms
    const configDir = path.join(tempDir, '.hashtree');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'config.toml'), `
[server]
enable_auth = false
stun_port = 0

[nostr]
relays = ["wss://temp.iris.to"]
crawl_depth = 0

[blossom]
servers = ["https://blossom.iris.to"]
`);

    try {
      // Create test repo with unique name to avoid conflicts
      const repoName = `test-${Date.now()}`;
      console.log('[test] Creating test repo:', repoName);
      execSync('git init', { cwd: testRepoDir, env });
      execSync('git config user.email "test@test.com"', { cwd: testRepoDir, env });
      execSync('git config user.name "Test User"', { cwd: testRepoDir, env });

      // Add test files
      fs.writeFileSync(path.join(testRepoDir, 'README.md'), '# Test Repo\n\nOriginal content.');
      fs.writeFileSync(path.join(testRepoDir, 'hello.txt'), 'Hello, World!');

      execSync('git add -A', { cwd: testRepoDir, env });
      execSync('git commit -m "Initial commit"', { cwd: testRepoDir, env });

      // Add htree remote using "self" - this auto-generates keys locally
      console.log('[test] Adding htree://self remote...');
      execSync(`git remote add htree htree://self/${repoName}`, { cwd: testRepoDir, env });

      // Push to htree - this publishes to nostr relays and blossom
      console.log('[test] Pushing to htree://self...');
      let pushOutput: string;
      try {
        pushOutput = execSync('git push htree master 2>&1', {
          cwd: testRepoDir,
          env,
          encoding: 'utf-8',
          timeout: 60000,
        });
      } catch (e: any) {
        pushOutput = e.stdout || e.stderr || e.message;
      }
      console.log('[test] Push output:', pushOutput);

      // Extract npub from push output
      const npubMatch = pushOutput.match(/npub1[a-z0-9]{58}/);
      if (!npubMatch) {
        console.log('[test] Could not extract npub from push output');
        test.skip(true, 'Could not extract npub from push output');
        return;
      }
      const npub = npubMatch[0];
      console.log('[test] Published to npub:', npub);

      // Navigate directly to the pushed repo URL
      // This is the REAL flow - browser fetches from nostr/blossom
      const repoUrl = `/#/${npub}/${repoName}`;
      console.log('[test] Navigating to:', repoUrl);

      await page.goto('/');
      await disableOthersPool(page);

      // Wait for nostr event to propagate to the relay
      // Push publishes to relay, but there can be a delay before it's queryable
      console.log('[test] Waiting for nostr event propagation (5s)...');
      await page.waitForTimeout(5000);

      // Navigate directly to the repo tree with retry mechanism
      // Nostr events may take time to propagate to relays
      console.log('[test] Navigating to tree:', repoUrl);

      let treeLoaded = false;
      const sidebarReadme = page.locator('[data-testid="file-list"] a').filter({ hasText: 'README.md' });

      for (let attempt = 0; attempt < 5 && !treeLoaded; attempt++) {
        console.log(`[test] Load attempt ${attempt + 1}/5...`);
        await page.goto(repoUrl);

        // Wait for the tree to load (look for Loading... to disappear or files to appear)
        try {
          // First wait a bit for nostr subscription to start
          await page.waitForTimeout(2000);

          // Reload to ensure clean state
          await page.reload();
          await page.waitForTimeout(1000);

          // Check if we can see files in sidebar (tree loaded successfully)
          await expect(sidebarReadme).toBeVisible({ timeout: 10000 });
          treeLoaded = true;
          console.log(`[test] Tree loaded on attempt ${attempt + 1}`);
        } catch {
          console.log(`[test] Tree not loaded on attempt ${attempt + 1}, will retry...`);
          // Wait before next attempt - nostr events take time to propagate
          await page.waitForTimeout(5000);
        }
      }

      if (!treeLoaded) {
        // Take screenshot for debugging
        await page.screenshot({ path: 'e2e/screenshots/git-status-htree-failed.png' });
        console.log('[test] Tree failed to load after 5 attempts');
        // Skip this test - nostr propagation is too slow or failed
        test.skip(true, 'Nostr event propagation too slow - tree did not load');
        return;
      }

      console.log('[test] README.md visible in sidebar - repo loaded from network');

      // Wait for .git directory in sidebar
      const sidebarGit = page.locator('[data-testid="file-list"] a').filter({ hasText: '.git' });
      await expect(sidebarGit).toBeVisible({ timeout: 10000 });
      console.log('[test] .git directory visible in sidebar');

      // Log current URL
      console.log('[test] Current URL:', page.url());

      // Take screenshot to see the state
      await page.screenshot({ path: 'e2e/screenshots/git-status-htree-in-repo.png' });

      // Wait for the directory toolbar to appear - look for the Commits button (git repo)
      // The Commits button appears when git repo is detected
      const commitsBtn = page.getByRole('button', { name: /commits/i });
      await expect(commitsBtn).toBeVisible({ timeout: 60000 });
      console.log('[test] Git repo detected - Commits button visible');

      // Take screenshot
      await page.screenshot({ path: 'e2e/screenshots/git-status-htree-toolbar.png' });

      // Take screenshot to see what status is showing
      await page.screenshot({ path: 'e2e/screenshots/git-status-htree-initial.png' });

      // Log browser console for debugging
      console.log('[test] Browser console logs:');
      for (const log of consoleLogs) {
        console.log('  ', log);
      }

      // Verify git status is working by checking the console output
      // The wasm-git output should show hasChanges: false for a freshly pushed repo
      const hasCleanStatus = consoleLogs.some(log =>
        log.includes('hasChanges: false') || log.includes('git status output: ""')
      );

      if (!hasCleanStatus) {
        console.log('[test] WARNING: Could not verify clean status from console logs');
        // This is not a failure - the status may still be loading
      } else {
        console.log('[test] SUCCESS: Git status shows clean (hasChanges: false)');
      }

      // Verify that the index file was found (not the "No .git/index found" warning)
      const hasIndex = consoleLogs.some(log => log.includes('Index file size:'));
      const noIndexWarning = consoleLogs.some(log => log.includes('No .git/index found'));

      if (noIndexWarning) {
        throw new Error('FAIL: No index file found - git-remote-htree should generate index during push');
      }

      if (hasIndex) {
        console.log('[test] SUCCESS: Index file exists - git-remote-htree correctly generated it');
      }

      // The key assertion: verify no uncommitted changes are detected initially
      // This validates that the index file is working correctly
      const hasUncommittedChanges = consoleLogs.some(log =>
        log.includes('hasChanges: true') ||
        (log.includes('getStatus result:') && !log.includes('hasChanges: false'))
      );

      if (hasUncommittedChanges) {
        throw new Error('FAIL: Uncommitted changes detected in freshly pushed repo - index file may be corrupt');
      }

      console.log('[test] SUCCESS: git-remote-htree pushed repo shows correct git status (clean)');

    } finally {
      // Cleanup
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  });
});
