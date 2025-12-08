import { test, expect } from '@playwright/test';

test.describe('Copy and Share functionality', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Login with new account
    await page.getByRole('button', { name: /New/i }).click();
    await page.waitForTimeout(1500);
  });

  // Helper to close any open modals
  async function closeModals(page) {
    const closeButton = page.getByRole('button', { name: 'Close' });
    if (await closeButton.isVisible({ timeout: 500 }).catch(() => false)) {
      await closeButton.click();
      await page.waitForTimeout(200);
    }
  }

  test.describe('CopyText in ProfileView', () => {
    test('should show npub with copy button in profile', async ({ page }) => {
      await closeModals(page);

      // Navigate to own profile
      const url = page.url();
      const npubMatch = url.match(/npub[a-z0-9]+/);
      expect(npubMatch).toBeTruthy();
      const npub = npubMatch![0];

      await page.goto(`/#/${npub}/profile`);
      await page.waitForTimeout(500);

      // Should see the copy button for npub
      const copyButton = page.getByTestId('copy-npub');
      await expect(copyButton).toBeVisible();

      // Should show truncated npub (first 8 + ... + last 4)
      const buttonText = await copyButton.textContent();
      expect(buttonText).toContain('npub');
      expect(buttonText).toContain('...');
    });

    test('should show check icon after clicking copy', async ({ page }) => {
      await closeModals(page);

      // Navigate to profile
      const url = page.url();
      const npubMatch = url.match(/npub[a-z0-9]+/);
      const npub = npubMatch![0];

      await page.goto(`/#/${npub}/profile`);
      await page.waitForTimeout(500);

      // Click copy button
      const copyButton = page.getByTestId('copy-npub');
      await copyButton.click();

      // Should show check icon
      await expect(copyButton.locator('.i-lucide-check')).toBeVisible();

      // After 2 seconds, should show copy icon again
      await page.waitForTimeout(2100);
      await expect(copyButton.locator('.i-lucide-copy')).toBeVisible();
    });
  });

  test.describe('ShareModal', () => {
    test('should open share modal when clicking share button', async ({ page }) => {
      await closeModals(page);

      // Navigate to profile
      const url = page.url();
      const npubMatch = url.match(/npub[a-z0-9]+/);
      const npub = npubMatch![0];

      await page.goto(`/#/${npub}/profile`);
      await page.waitForTimeout(500);

      // Click share button
      await page.getByRole('button', { name: 'Share' }).click();
      await page.waitForTimeout(300);

      // Modal should be visible
      await expect(page.getByTestId('share-modal')).toBeVisible();
    });

    test('should display QR code in share modal', async ({ page }) => {
      await closeModals(page);

      const url = page.url();
      const npubMatch = url.match(/npub[a-z0-9]+/);
      const npub = npubMatch![0];

      await page.goto(`/#/${npub}/profile`);
      await page.waitForTimeout(500);

      await page.getByRole('button', { name: 'Share' }).click();
      await page.waitForTimeout(500);

      // Should show QR code image
      const qrCode = page.getByTestId('share-qr-code');
      await expect(qrCode).toBeVisible();

      // QR code should have a valid src
      const src = await qrCode.getAttribute('src');
      expect(src).toContain('data:image/png');
    });

    test('should show URL with copy button in share modal', async ({ page }) => {
      await closeModals(page);

      const url = page.url();
      const npubMatch = url.match(/npub[a-z0-9]+/);
      const npub = npubMatch![0];

      await page.goto(`/#/${npub}/profile`);
      await page.waitForTimeout(500);

      await page.getByRole('button', { name: 'Share' }).click();
      await page.waitForTimeout(300);

      // Should show CopyText component with URL
      const copyUrl = page.getByTestId('share-copy-url');
      await expect(copyUrl).toBeVisible();

      // Should contain the share URL
      const text = await copyUrl.textContent();
      expect(text).toContain(npub);
    });

    test('should copy URL when clicking copy in share modal', async ({ page }) => {
      await closeModals(page);

      const url = page.url();
      const npubMatch = url.match(/npub[a-z0-9]+/);
      const npub = npubMatch![0];

      await page.goto(`/#/${npub}/profile`);
      await page.waitForTimeout(500);

      await page.getByRole('button', { name: 'Share' }).click();
      await page.waitForTimeout(300);

      // Click copy button
      const copyUrl = page.getByTestId('share-copy-url');
      await copyUrl.click();

      // Should show check icon
      await expect(copyUrl.locator('.i-lucide-check')).toBeVisible();
    });

    test('should close share modal when clicking backdrop', async ({ page }) => {
      await closeModals(page);

      const url = page.url();
      const npubMatch = url.match(/npub[a-z0-9]+/);
      const npub = npubMatch![0];

      await page.goto(`/#/${npub}/profile`);
      await page.waitForTimeout(500);

      await page.getByRole('button', { name: 'Share' }).click();
      await page.waitForTimeout(300);

      // Click on backdrop (modal overlay)
      await page.getByTestId('share-modal-backdrop').click({ position: { x: 10, y: 10 } });
      await page.waitForTimeout(300);

      // Modal should be closed
      await expect(page.getByTestId('share-modal')).not.toBeVisible();
    });

    test('should close share modal when clicking QR code', async ({ page }) => {
      await closeModals(page);

      const url = page.url();
      const npubMatch = url.match(/npub[a-z0-9]+/);
      const npub = npubMatch![0];

      await page.goto(`/#/${npub}/profile`);
      await page.waitForTimeout(500);

      await page.getByRole('button', { name: 'Share' }).click();
      await page.waitForTimeout(500);

      // Click on QR code
      await page.getByTestId('share-qr-code').click();
      await page.waitForTimeout(300);

      // Modal should be closed
      await expect(page.getByTestId('share-modal')).not.toBeVisible();
    });

    test('should close share modal with Escape key', async ({ page }) => {
      await closeModals(page);

      const url = page.url();
      const npubMatch = url.match(/npub[a-z0-9]+/);
      const npub = npubMatch![0];

      await page.goto(`/#/${npub}/profile`);
      await page.waitForTimeout(500);

      await page.getByRole('button', { name: 'Share' }).click();
      await page.waitForTimeout(300);

      // Press Escape
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      // Modal should be closed
      await expect(page.getByTestId('share-modal')).not.toBeVisible();
    });
  });
});
