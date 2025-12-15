import { test, expect } from '@playwright/test';
import { setupPageErrorHandler, disableOthersPool } from './test-utils';

/**
 * Tests for docs.iris.to (Iris Docs app)
 * Tests the simplified document-focused UI
 */
test.describe('Iris Docs App', () => {
  test.beforeEach(async ({ page }) => {
    setupPageErrorHandler(page);
  });

  test('shows Iris Docs header', async ({ page }) => {
    await page.goto('/docs.html#/');

    // Should show the Iris Docs header
    await expect(page.locator('text=Iris Docs')).toBeVisible({ timeout: 10000 });
  });

  test('shows New Document card after login', async ({ page }) => {
    await page.goto('/docs.html#/');
    await disableOthersPool(page);

    // Login with new account
    await page.getByRole('button', { name: /New/i }).click();

    // Wait for login to complete - New Document card button should appear
    await expect(page.locator('button:has-text("New Document")')).toBeVisible({ timeout: 15000 });
  });

  test('can create new document', async ({ page }) => {
    await page.goto('/docs.html#/');
    await disableOthersPool(page);

    // Login with new account
    await page.getByRole('button', { name: /New/i }).click();

    // Wait for New Document card button to appear
    const newDocCard = page.locator('button:has-text("New Document")');
    await expect(newDocCard).toBeVisible({ timeout: 15000 });

    // Close any open modal first (press Escape)
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // Click New Document card to open modal
    await newDocCard.click();

    // Modal should appear with input
    await expect(page.getByRole('heading', { name: 'New Document' })).toBeVisible({ timeout: 5000 });

    // Enter document name
    const docName = `Test Doc ${Date.now()}`;
    await page.locator('input[placeholder="Document name..."]').fill(docName);

    // Should show visibility picker (buttons with public/unlisted/private)
    await expect(page.locator('button:has-text("public")')).toBeVisible({ timeout: 5000 });

    // Click Create button
    await page.getByRole('button', { name: 'Create' }).click();

    // Should navigate to the new document (URL contains docs/ prefix)
    await page.waitForURL(/\/docs\.html#\/npub.*\/docs\//, { timeout: 15000 });

    // URL should contain the docs/ prefix
    expect(page.url()).toContain('/docs/');

    // Verify document editor is visible (formatting toolbar with Bold button)
    await expect(page.locator('button[title="Bold (Ctrl+B)"]')).toBeVisible({ timeout: 10000 });

    // Verify the editor container is present
    await expect(page.locator('.ProseMirror-container')).toBeVisible();
  });

  test('header has Iris Docs branding', async ({ page }) => {
    await page.goto('/docs.html#/');

    // Should have Iris Docs logo/title
    await expect(page.locator('text=Iris Docs')).toBeVisible({ timeout: 10000 });
  });

  test('document persists after refresh and shows on home', async ({ page }) => {
    await page.goto('/docs.html#/');
    await disableOthersPool(page);

    // Login with new account
    await page.getByRole('button', { name: /New/i }).click();

    // Wait for New Document card
    const newDocCard = page.locator('button:has-text("New Document")');
    await expect(newDocCard).toBeVisible({ timeout: 15000 });

    // Close any modal and create document
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await newDocCard.click();

    // Fill in document name
    const docName = `Persist Test ${Date.now()}`;
    await page.locator('input[placeholder="Document name..."]').fill(docName);
    await page.getByRole('button', { name: 'Create' }).click();

    // Wait for editor to load
    await expect(page.locator('button[title="Bold (Ctrl+B)"]')).toBeVisible({ timeout: 10000 });

    // Type some text in the editor
    const editor = page.locator('.ProseMirror');
    await editor.click();
    await editor.type('Hello persistence test!');

    // Wait for autosave (1s debounce + 1s publish throttle + buffer)
    await page.waitForTimeout(3000);

    // Refresh the page
    await page.reload();

    // Wait for editor to load again
    await expect(page.locator('button[title="Bold (Ctrl+B)"]')).toBeVisible({ timeout: 10000 });

    // Verify text is still there (give time for content to load from cache)
    await expect(page.locator('.ProseMirror')).toContainText('Hello persistence test!', { timeout: 10000 });

    // Go to home page by evaluating hash change (keeps session)
    await page.evaluate(() => window.location.hash = '#/');

    // Wait for the New Document card to appear (confirms home page loaded)
    await expect(page.locator('button:has-text("New Document")')).toBeVisible({ timeout: 10000 });

    // Verify document appears in the list
    const displayName = docName;
    await expect(page.locator(`text=${displayName}`)).toBeVisible({ timeout: 10000 });
  });

  test('can navigate from home to document and view content', async ({ page }) => {
    await page.goto('/docs.html#/');
    await disableOthersPool(page);

    // Login with new account
    await page.getByRole('button', { name: /New/i }).click();

    // Wait for New Document card
    const newDocCard = page.locator('button:has-text("New Document")');
    await expect(newDocCard).toBeVisible({ timeout: 15000 });

    // Create a document
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await newDocCard.click();

    // Fill in document name and create
    const docName = `Navigate Test ${Date.now()}`;
    await page.locator('input[placeholder="Document name..."]').fill(docName);
    await page.getByRole('button', { name: 'Create' }).click();

    // Wait for editor to load and type some content
    await expect(page.locator('button[title="Bold (Ctrl+B)"]')).toBeVisible({ timeout: 10000 });
    const editor = page.locator('.ProseMirror');
    await editor.click();
    await editor.type('Content for navigation test');

    // Wait for autosave
    await page.waitForTimeout(3000);

    // Go to home page
    await page.evaluate(() => window.location.hash = '#/');

    // Wait for home page and find the document
    await expect(page.locator('button:has-text("New Document")')).toBeVisible({ timeout: 10000 });

    // Click on the document card to navigate to it
    const docCard = page.locator(`text=${docName}`);
    await expect(docCard).toBeVisible({ timeout: 10000 });
    await docCard.click();

    // Verify we're back in the editor with the content
    await expect(page.locator('button[title="Bold (Ctrl+B)"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.ProseMirror')).toContainText('Content for navigation test', { timeout: 10000 });
  });

  test('edits to existing document persist after navigation and refresh', async ({ page }, testInfo) => {
    testInfo.setTimeout(45000);

    await page.goto('/docs.html#/');
    await disableOthersPool(page);

    // Login
    await page.getByRole('button', { name: /New/i }).click();
    await expect(page.locator('button:has-text("New Document")')).toBeVisible({ timeout: 15000 });

    // Create a document
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await page.locator('button:has-text("New Document")').click();

    const docName = `Edit Persist Test ${Date.now()}`;
    await page.locator('input[placeholder="Document name..."]').fill(docName);
    await page.getByRole('button', { name: 'Create' }).click();

    // Wait for editor and type initial content
    await expect(page.locator('button[title="Bold (Ctrl+B)"]')).toBeVisible({ timeout: 10000 });
    const editor = page.locator('.ProseMirror');
    await editor.click();
    await editor.type('Initial content.');

    // Wait for autosave
    await page.waitForTimeout(3000);

    // Navigate to home
    await page.evaluate(() => window.location.hash = '#/');
    await expect(page.locator('button:has-text("New Document")')).toBeVisible({ timeout: 10000 });

    // Refresh the page
    await page.reload();
    await expect(page.locator('button:has-text("New Document")')).toBeVisible({ timeout: 10000 });

    // Navigate back to the document
    const docCard = page.locator(`text=${docName}`);
    await expect(docCard).toBeVisible({ timeout: 10000 });
    await docCard.click();

    // Verify initial content is there
    await expect(page.locator('button[title="Bold (Ctrl+B)"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.ProseMirror')).toContainText('Initial content.', { timeout: 10000 });

    // Add more content
    const editor2 = page.locator('.ProseMirror');
    await editor2.click();
    await editor2.press('End');
    await editor2.type(' Added more content.');

    // Wait for autosave
    await page.waitForTimeout(4000);

    // Refresh to verify edits persist
    await page.reload();

    // Wait for editor to load
    await expect(page.locator('button[title="Bold (Ctrl+B)"]')).toBeVisible({ timeout: 10000 });

    // Verify all content is there
    await expect(page.locator('.ProseMirror')).toContainText('Initial content. Added more content.', { timeout: 10000 });
  });

  test('another browser can view document via shared link', async ({ browser }, testInfo) => {
    testInfo.setTimeout(60000);

    // Create two separate browser contexts (like two different browsers/incognito)
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    setupPageErrorHandler(page1);
    setupPageErrorHandler(page2);

    try {
      // Browser 1: Login first
      await page1.goto('/docs.html#/');
      await disableOthersPool(page1);
      await page1.getByRole('button', { name: /New/i }).click();
      await expect(page1.locator('button:has-text("New Document")')).toBeVisible({ timeout: 15000 });

      // Browser 2: Login
      await page2.goto('/docs.html#/');
      await disableOthersPool(page2);
      await page2.getByRole('button', { name: /New/i }).click();
      await expect(page2.locator('button:has-text("New Document")')).toBeVisible({ timeout: 15000 });

      // Get npubs from both browsers
      const npub1 = await page1.evaluate(() => (window as any).__nostrStore?.getState()?.npub);
      const npub2 = await page2.evaluate(() => (window as any).__nostrStore?.getState()?.npub);
      console.log('Browser 1 npub:', npub1);
      console.log('Browser 2 npub:', npub2);

      // Have them follow each other for WebRTC connection
      await page1.evaluate((npub) => {
        (window as any).__nostrStore?.getState()?.follow?.(npub);
      }, npub2);
      await page2.evaluate((npub) => {
        (window as any).__nostrStore?.getState()?.follow?.(npub);
      }, npub1);

      // Wait for WebRTC connection
      await page1.waitForTimeout(2000);

      // Browser 1: Create a document
      await page1.keyboard.press('Escape');
      await page1.waitForTimeout(200);
      await page1.locator('button:has-text("New Document")').click();

      const docName = `Shared Doc ${Date.now()}`;
      await page1.locator('input[placeholder="Document name..."]').fill(docName);
      await page1.getByRole('button', { name: 'Create' }).click();

      // Wait for editor and type content
      await expect(page1.locator('button[title="Bold (Ctrl+B)"]')).toBeVisible({ timeout: 10000 });
      const editor1 = page1.locator('.ProseMirror');
      await editor1.click();
      await editor1.type('Hello from browser 1!');

      // Wait for autosave
      await page1.waitForTimeout(3000);

      // Get the document hash path
      const docUrl = page1.url();
      const hashPath = new URL(docUrl).hash; // e.g., #/npub.../docs/docname
      console.log('Document URL:', docUrl);
      console.log('Hash path:', hashPath);

      // Browser 2: Navigate to the document using hash (keeps session)
      await page2.keyboard.press('Escape'); // Close any modals
      await page2.waitForTimeout(200);
      await page2.evaluate((hash) => window.location.hash = hash.slice(1), hashPath);

      // Verify the content is visible in browser 2 (may be read-only mode without edit toolbar)
      await expect(page2.locator('.ProseMirror')).toContainText('Hello from browser 1!', { timeout: 10000 });
    } finally {
      await context1.close();
      await context2.close();
    }
  });

  test('editor maintains focus after auto-save in docs app', async ({ page }) => {
    // This test verifies the DocView fix - editor shouldn't unmount on tree root update
    await page.goto('/docs.html#/');
    await disableOthersPool(page);

    // Login with new account
    await page.getByRole('button', { name: /New/i }).click();

    // Wait for New Document card
    const newDocCard = page.locator('button:has-text("New Document")');
    await expect(newDocCard).toBeVisible({ timeout: 15000 });

    // Create a document
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await newDocCard.click();

    const docName = `Focus Test ${Date.now()}`;
    await page.locator('input[placeholder="Document name..."]').fill(docName);
    await page.getByRole('button', { name: 'Create' }).click();

    // Wait for editor to load
    const editor = page.locator('.ProseMirror');
    await expect(editor).toBeVisible({ timeout: 10000 });
    await editor.click();

    // Type initial content
    await page.keyboard.type('First sentence.');

    // Wait for auto-save to complete (1s debounce + save time + store update cascade)
    await page.waitForTimeout(3000);

    // Verify editor still has focus
    const hasFocus = await page.evaluate(() => {
      const active = document.activeElement;
      const editor = document.querySelector('.ProseMirror');
      return editor?.contains(active) || active === editor;
    });
    expect(hasFocus).toBe(true);

    // Type more content WITHOUT clicking the editor again
    await page.keyboard.type(' Second sentence.');

    // Verify both sentences are in the editor
    await expect(editor).toContainText('First sentence. Second sentence.', { timeout: 5000 });
  });
});
