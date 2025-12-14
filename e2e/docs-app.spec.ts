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
});
