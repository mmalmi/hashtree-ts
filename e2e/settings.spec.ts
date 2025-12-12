import { test, expect } from '@playwright/test';
import { setupPageErrorHandler } from './test-utils.js';

test.describe('Settings page', () => {
  test('can navigate to settings page', { timeout: 30000 }, async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');

    // Click settings link (gear icon in header)
    const settingsLink = page.locator('a[href="#/settings"]');
    await expect(settingsLink).toBeVisible({ timeout: 5000 });
    await settingsLink.click();

    await page.waitForURL(/#\/settings/, { timeout: 5000 });

    // Verify we're on settings page
    await expect(page.locator('text=Settings')).toBeVisible({ timeout: 5000 });
  });

  test('can add and remove blossom server', { timeout: 60000 }, async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/#/settings');

    // Wait for settings page to load
    await expect(page.locator('text=Blossom Servers')).toBeVisible({ timeout: 10000 });

    // Click Edit button for blossom servers
    const blossomSection = page.locator('div').filter({ hasText: /^Blossom Servers/ }).first();
    const editBtn = blossomSection.locator('button', { hasText: 'Edit' });
    await expect(editBtn).toBeVisible({ timeout: 5000 });
    await editBtn.click();

    // Input field should appear
    const urlInput = page.locator('input[placeholder="https://blossom.example.com"]');
    await expect(urlInput).toBeVisible({ timeout: 5000 });

    // Add a new server
    const testServerUrl = 'https://test-blossom.example.com';
    await urlInput.fill(testServerUrl);

    await page.screenshot({ path: '/tmp/before-add-click.png' });

    // Click Add button
    const addBtn = page.locator('button', { hasText: 'Add' });
    await expect(addBtn).toBeVisible({ timeout: 5000 });
    console.log('About to click Add button...');
    await addBtn.click({ timeout: 5000 });
    console.log('Add button clicked');

    await page.screenshot({ path: '/tmp/after-add-click.png' });

    // Verify the server appears in the list
    await expect(page.locator('text=test-blossom.example.com')).toBeVisible({ timeout: 5000 });

    // Now remove the server we just added
    // Find the row containing our test server hostname and click its X button
    // The server row structure is: div > [icon, span.hostname, checkboxes..., button]
    const serverSpan = page.locator('span:has-text("test-blossom.example.com")');
    const serverRow = serverSpan.locator('xpath=..');
    const removeBtn = serverRow.getByRole('button', { name: 'Remove server' });
    await expect(removeBtn).toBeVisible({ timeout: 5000 });
    await removeBtn.click();

    // Verify the server is removed
    await expect(page.locator('text=test-blossom.example.com')).not.toBeVisible({ timeout: 5000 });
  });

  test('can toggle blossom server read/write', { timeout: 60000 }, async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/#/settings');

    // Wait for settings page to load
    await expect(page.locator('text=Blossom Servers')).toBeVisible({ timeout: 10000 });

    // Find the first blossom server row (should be files.iris.to by default)
    const firstServerRow = page.locator('div').filter({ hasText: /files\.iris\.to/ }).first();
    await expect(firstServerRow).toBeVisible({ timeout: 5000 });

    // Find read checkbox
    const readCheckbox = firstServerRow.locator('input[type="checkbox"]').first();
    await expect(readCheckbox).toBeVisible({ timeout: 5000 });

    // Toggle read off
    const wasChecked = await readCheckbox.isChecked();
    await readCheckbox.click();

    // Verify it toggled
    const isNowChecked = await readCheckbox.isChecked();
    expect(isNowChecked).toBe(!wasChecked);

    // Toggle back
    await readCheckbox.click();
    expect(await readCheckbox.isChecked()).toBe(wasChecked);
  });

  test('settings page does not freeze with rapid interactions', { timeout: 30000 }, async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/#/settings');

    // Wait for page to load
    await expect(page.locator('text=Blossom Servers')).toBeVisible({ timeout: 10000 });

    // Rapidly toggle editing mode multiple times
    for (let i = 0; i < 5; i++) {
      const editBtn = page.locator('button', { hasText: /Edit|Done/ }).first();
      await expect(editBtn).toBeVisible({ timeout: 2000 });
      await editBtn.click();
      // Small delay to allow UI to update
      await page.waitForTimeout(100);
    }

    // Page should still be responsive - verify we can still interact
    await expect(page.locator('text=Settings')).toBeVisible({ timeout: 5000 });

    // Try scrolling to verify page is responsive
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(500);

    // Verify About section is still accessible
    await expect(page.locator('text=About')).toBeVisible({ timeout: 5000 });
  });
});
