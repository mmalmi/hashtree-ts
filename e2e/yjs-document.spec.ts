/**
 * E2E tests for Yjs document viewer
 *
 * Tests that directories with .yjs file are detected and rendered with Tiptap editor.
 * A Yjs document directory is identified by having a .yjs config file inside.
 */
import { test, expect } from '@playwright/test';
import { setupPageErrorHandler, navigateToPublicFolder } from './test-utils.js';

test.describe('Yjs Document Viewer', () => {
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

  test('New Document button creates folder with .yjs file', async ({ page }) => {
    // We're inside the public folder from navigateToPublicFolder

    // Click New Document button
    await page.getByRole('button', { name: 'New Document' }).click();
    await page.waitForTimeout(500);

    // Fill in document name
    await page.locator('input[placeholder="Document name..."]').fill('notes');
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(1500);

    // The folder should be visible (named "notes", not "notes.yjs")
    const docFolder = page.locator('a:has-text("notes")').first();
    await expect(docFolder).toBeVisible({ timeout: 5000 });

    // Click to navigate into the document folder
    await docFolder.click();
    await page.waitForTimeout(2000);

    // Verify .yjs file exists inside the folder
    const yjsFile = page.locator('a:has-text(".yjs")');
    await expect(yjsFile).toBeVisible({ timeout: 5000 });
  });

  test('non-document directory shows normal directory actions', async ({ page }) => {
    // We're inside the public folder from navigateToPublicFolder

    // Create a regular subfolder using New Folder button
    await page.getByRole('button', { name: 'New Folder' }).first().click();
    await page.waitForTimeout(500);
    await page.locator('input[placeholder="Folder name..."]').fill('regular-folder');
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(1500);

    // Wait for the folder to appear
    const regularFolder = page.locator('a:has-text("regular-folder")');
    await expect(regularFolder).toBeVisible({ timeout: 5000 });

    // Navigate into the regular folder
    await regularFolder.click();
    await page.waitForTimeout(1000);

    // Should show normal directory view - look for the upload drop zone text
    const dropZone = page.locator('text=Drop or click to add');
    await expect(dropZone).toBeVisible({ timeout: 5000 });

    // Should NOT show the Tiptap ProseMirror editor
    const editor = page.locator('.ProseMirror');
    await expect(editor).not.toBeVisible();

    // Should have File/Folder/Document buttons visible
    await expect(page.getByRole('button', { name: 'New File' })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: 'New Folder' })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: 'New Document' })).toBeVisible({ timeout: 5000 });
  });

  test('folder with manually created .yjs file shows Tiptap editor', async ({ page }) => {
    // We're inside the public folder from navigateToPublicFolder

    // Create a regular folder first
    await page.getByRole('button', { name: 'New Folder' }).first().click();
    await page.waitForTimeout(500);
    await page.locator('input[placeholder="Folder name..."]').fill('manual-doc');
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(1500);

    // Navigate into the folder
    const folder = page.locator('a:has-text("manual-doc")');
    await expect(folder).toBeVisible({ timeout: 5000 });
    await folder.click();
    await page.waitForTimeout(1000);

    // Should show normal directory (no .yjs file yet)
    const dropZone = page.locator('text=Drop or click to add');
    await expect(dropZone).toBeVisible({ timeout: 5000 });

    // Create a .yjs file inside
    await page.getByRole('button', { name: 'New File' }).click();
    await page.waitForTimeout(500);
    await page.locator('input[placeholder="File name..."]').fill('.yjs');
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(1500);

    // Go back to parent
    await page.locator('a:has-text("..")').click();
    await page.waitForTimeout(1000);

    // Navigate back into the folder
    await page.locator('a:has-text("manual-doc")').click();
    await page.waitForTimeout(1500);

    // Should now show the Tiptap editor (detects .yjs file)
    const editor = page.locator('.ProseMirror, .prose');
    await expect(editor.first()).toBeVisible({ timeout: 10000 });

    // Should show the document name in the toolbar (use font-medium class to target toolbar)
    const docName = page.locator('.font-medium:has-text("manual-doc")');
    await expect(docName).toBeVisible({ timeout: 5000 });
  });

  test('typing in document editor works and auto-saves', async ({ page }) => {
    // We're inside the public folder from navigateToPublicFolder

    // Click New Document button
    await page.getByRole('button', { name: 'New Document' }).click();
    await page.waitForTimeout(500);

    // Fill in document name
    await page.locator('input[placeholder="Document name..."]').fill('editable-doc');
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(2000);

    // Should show the document name in the toolbar
    const docName = page.getByText('editable-doc').first();
    await expect(docName).toBeVisible({ timeout: 5000 });

    // Click in the editor
    const editor = page.locator('.ProseMirror');
    await expect(editor).toBeVisible({ timeout: 5000 });
    await editor.click();

    // Type some text
    await page.keyboard.type('Hello, this is a test document!');
    await page.waitForTimeout(500);

    // Verify text appears in editor
    await expect(editor).toContainText('Hello, this is a test document!');

    // Wait for auto-save (1 second debounce + some buffer)
    await page.waitForTimeout(2000);

    // Should show "Saved" status
    const savedStatus = page.locator('text=Saved');
    await expect(savedStatus).toBeVisible({ timeout: 5000 });

    // Verify a "doc" file was created in the folder (with a size indicator)
    const docFile = page.getByRole('link', { name: /^doc \d+ B$/ });
    await expect(docFile).toBeVisible({ timeout: 5000 });
  });

  test('clicking .yjs file to view it does not cause errors', async ({ page }) => {
    // This test verifies that viewing a .yjs file directly doesn't throw
    // "undefined is not iterable" errors in Viewer.tsx

    // Track console errors
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    page.on('pageerror', err => {
      consoleErrors.push(err.message);
    });

    // We're inside the public folder from navigateToPublicFolder

    // Create a document folder using New Document button
    await page.getByRole('button', { name: 'New Document' }).click();
    await page.waitForTimeout(1000);

    await page.locator('input[placeholder="Document name..."]').fill('test-doc');
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(3000);

    // After creating a document, we should automatically navigate into it
    // Verify the .yjs file is visible (we're inside the document folder)
    const yjsFile = page.locator('a:has-text(".yjs")');
    await expect(yjsFile).toBeVisible({ timeout: 10000 });

    // Click on the .yjs file to view it - this should not cause errors
    await yjsFile.click();
    await page.waitForTimeout(3000);

    // Verify we're viewing the file (header shows filename)
    // The file viewer should show the .yjs filename
    const fileHeader = page.locator('span:has-text(".yjs")');
    await expect(fileHeader.first()).toBeVisible({ timeout: 10000 });

    // Wait a bit more to ensure any async errors would have appeared
    await page.waitForTimeout(2000);

    // Filter for the specific error we're fixing
    const iterableErrors = consoleErrors.filter(e => e.includes('undefined is not iterable'));
    expect(iterableErrors).toHaveLength(0);
  });
});
