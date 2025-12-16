import { test, expect } from '@playwright/test';
import { setupPageErrorHandler, disableOthersPool } from './test-utils';

/**
 * Tests for document thumbnail generation and display
 */
test.describe('Document Thumbnails', () => {
  test.beforeEach(async ({ page }) => {
    setupPageErrorHandler(page);
  });

  test('generates and displays thumbnail for document', async ({ page }) => {
    // Use slow mode since thumbnail capture is throttled (30s) but we'll override
    test.slow();

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

    const docName = `Thumbnail Test ${Date.now()}`;
    await page.locator('input[placeholder="Document name..."]').fill(docName);
    await page.getByRole('button', { name: 'Create' }).click();

    // Wait for editor to load
    await expect(page.locator('button[title="Bold (Ctrl+B)"]')).toBeVisible({ timeout: 30000 });

    // Type some visible content that will appear in the thumbnail
    const editor = page.locator('.ProseMirror');
    await editor.click();
    await editor.type('This is a test document with some content for the thumbnail preview.');

    // Wait for initial autosave to complete
    await page.waitForTimeout(2000);

    // Reset the throttle timer to allow immediate thumbnail capture
    await page.evaluate(() => {
      const reset = (window as any).__thumbnailCaptureReset;
      if (reset) reset();
    });

    // Trigger another save by adding more content
    await editor.type(' More text.');

    // Wait for autosave (which triggers thumbnail capture)
    // 1s debounce + requestIdleCallback + capture time
    await page.waitForTimeout(6000);

    // Verify thumbnail was saved by checking the tree
    const hasThumbnail = await page.evaluate(async () => {
      const { getTree } = await import('/src/store');
      const { getTreeRootSync } = await import('/src/stores');
      const nostrStore = (window as any).__nostrStore;

      const npub = nostrStore?.getState()?.npub;
      const treeNameEncoded = window.location.hash.match(/\/docs\/([^/?]+)/)?.[1];
      const treeName = treeNameEncoded ? decodeURIComponent(treeNameEncoded) : null;

      if (!npub || !treeName) return false;

      const rootCid = getTreeRootSync(npub, `docs/${treeName}`);
      if (!rootCid) return false;

      const tree = getTree();
      const result = await tree.resolvePath(rootCid, '.thumbnail.jpg');
      return !!result;
    });

    expect(hasThumbnail).toBe(true);

    // Navigate to home page
    await page.evaluate(() => window.location.hash = '#/');

    // Wait for doc cards to load
    await expect(page.locator('button:has-text("New Document")')).toBeVisible({ timeout: 30000 });

    // Find the doc card and verify it has a thumbnail image
    const docCard = page.locator(`a:has-text("${docName}")`);
    await expect(docCard).toBeVisible({ timeout: 30000 });

    // The thumbnail image should be visible inside the card (first img, not the avatar)
    // Thumbnail has object-cover class, avatar doesn't
    const thumbnailImg = docCard.locator('img.object-cover');
    await expect(thumbnailImg).toBeVisible({ timeout: 10000 });

    // Verify the image has loaded (has non-zero dimensions)
    const imgLoaded = await thumbnailImg.evaluate((img: HTMLImageElement) => {
      return img.complete && img.naturalWidth > 0;
    });
    expect(imgLoaded).toBe(true);
  });

  test('shows file icon when no thumbnail exists', async ({ page }) => {
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

    const docName = `No Thumb Test ${Date.now()}`;
    await page.locator('input[placeholder="Document name..."]').fill(docName);
    await page.getByRole('button', { name: 'Create' }).click();

    // Wait for editor
    await expect(page.locator('button[title="Bold (Ctrl+B)"]')).toBeVisible({ timeout: 30000 });

    // Don't type anything - just wait briefly for autosave
    // The throttle should prevent thumbnail capture since this is a new doc
    await page.waitForTimeout(2000);

    // Navigate to home before thumbnail has a chance to be captured
    await page.evaluate(() => window.location.hash = '#/');

    // Wait for doc cards to load
    await expect(page.locator('button:has-text("New Document")')).toBeVisible({ timeout: 30000 });

    // Find the doc card
    const docCard = page.locator(`a:has-text("${docName}")`);
    await expect(docCard).toBeVisible({ timeout: 30000 });

    // Should show the file icon (not an img)
    const fileIcon = docCard.locator('.i-lucide-file-text');
    await expect(fileIcon).toBeVisible({ timeout: 5000 });
  });

  test('thumbnail updates when document content changes', async ({ page }) => {
    test.slow();

    await page.goto('/docs.html#/');
    await disableOthersPool(page);

    // Login
    await page.getByRole('button', { name: /New/i }).click();
    await expect(page.locator('button:has-text("New Document")')).toBeVisible({ timeout: 15000 });

    // Create a document
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await page.locator('button:has-text("New Document")').click();

    const docName = `Update Thumb ${Date.now()}`;
    await page.locator('input[placeholder="Document name..."]').fill(docName);
    await page.getByRole('button', { name: 'Create' }).click();

    // Wait for editor
    await expect(page.locator('button[title="Bold (Ctrl+B)"]')).toBeVisible({ timeout: 30000 });

    // Type initial content
    const editor = page.locator('.ProseMirror');
    await editor.click();
    await editor.type('Initial content for first thumbnail.');

    // Wait for save and reset throttle to allow thumbnail capture
    await page.waitForTimeout(2000);
    await page.evaluate(() => {
      const reset = (window as any).__thumbnailCaptureReset;
      if (reset) reset();
    });

    // Add a bit more to trigger save with thumbnail
    await editor.type('.');
    await page.waitForTimeout(6000);

    // Get the first thumbnail hash
    const firstThumbHash = await page.evaluate(async () => {
      const { getTree } = await import('/src/store');
      const { getTreeRootSync } = await import('/src/stores');
      const nostrStore = (window as any).__nostrStore;

      const npub = nostrStore?.getState()?.npub;
      const treeNameEncoded = window.location.hash.match(/\/docs\/([^/?]+)/)?.[1];
      const treeName = treeNameEncoded ? decodeURIComponent(treeNameEncoded) : null;
      if (!npub || !treeName) return null;

      const rootCid = getTreeRootSync(npub, `docs/${treeName}`);
      if (!rootCid) return null;

      const tree = getTree();
      const result = await tree.resolvePath(rootCid, '.thumbnail.jpg');
      if (!result) return null;

      // Return hash as hex string
      return Array.from(result.cid.hash).map(b => b.toString(16).padStart(2, '0')).join('');
    });

    // Reset throttle and add more content
    await page.evaluate(() => {
      const reset = (window as any).__thumbnailCaptureReset;
      if (reset) reset();
    });

    await editor.click();
    await editor.press('End');
    await editor.type(' More content added for second thumbnail.');

    // Wait for new thumbnail
    await page.waitForTimeout(6000);

    // Get the second thumbnail hash
    const secondThumbHash = await page.evaluate(async () => {
      const { getTree } = await import('/src/store');
      const { getTreeRootSync } = await import('/src/stores');
      const nostrStore = (window as any).__nostrStore;

      const npub = nostrStore?.getState()?.npub;
      const treeNameEncoded = window.location.hash.match(/\/docs\/([^/?]+)/)?.[1];
      const treeName = treeNameEncoded ? decodeURIComponent(treeNameEncoded) : null;
      if (!npub || !treeName) return null;

      const rootCid = getTreeRootSync(npub, `docs/${treeName}`);
      if (!rootCid) return null;

      const tree = getTree();
      const result = await tree.resolvePath(rootCid, '.thumbnail.jpg');
      if (!result) return null;

      return Array.from(result.cid.hash).map(b => b.toString(16).padStart(2, '0')).join('');
    });

    // Both should exist
    expect(firstThumbHash).toBeTruthy();
    expect(secondThumbHash).toBeTruthy();

    // They should be different (content changed)
    expect(secondThumbHash).not.toBe(firstThumbHash);
  });
});
