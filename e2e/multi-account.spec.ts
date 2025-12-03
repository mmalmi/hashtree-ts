import { test, expect } from '@playwright/test';
import { setupPageErrorHandler, waitForNewUserRedirect, myTreesButtonSelector } from './test-utils.js';

// Helper to navigate to accounts page
async function navigateToAccountsPage(page: any) {
  // Double-click on avatar to go to accounts
  await page.locator(myTreesButtonSelector).dblclick();
  await page.waitForTimeout(300);

  // Should be on accounts page
  await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible({ timeout: 5000 });
}

// Generate a test nsec for adding accounts
function generateTestNsec(): string {
  // This is a deterministic nsec for testing purposes only
  return 'nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5';
}

test.describe('Multi-Account Management', () => {
  test.beforeEach(async ({ page }) => {
    setupPageErrorHandler(page);

    await page.goto('/');

    // Clear storage
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
    await page.waitForSelector('header span:has-text("Hashtree")', { timeout: 5000 });
    await waitForNewUserRedirect(page);
  });

  test('should navigate to accounts page via double-click on avatar', async ({ page }) => {
    await navigateToAccountsPage(page);

    // Verify accounts page elements
    await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add with nsec' })).toBeVisible();
  });

  test('should show initial auto-generated account', async ({ page }) => {
    await navigateToAccountsPage(page);

    // Should show 1 account initially (auto-generated) with nsec type indicator
    await expect(page.getByText('nsec').first()).toBeVisible({ timeout: 5000 });

    // Current account should be shown with check mark
    await expect(page.locator('span.i-lucide-check-circle').first()).toBeVisible();
  });

  test('should add account with nsec', async ({ page }) => {
    await navigateToAccountsPage(page);

    // Click "Add with nsec" button
    await page.getByRole('button', { name: 'Add with nsec' }).click();
    await page.waitForTimeout(200);

    // Input should be visible
    const nsecInput = page.locator('input[placeholder="nsec1..."]');
    await expect(nsecInput).toBeVisible();

    // Enter a valid test nsec
    await nsecInput.fill(generateTestNsec());
    await page.getByRole('button', { name: 'Add' }).click();
    await page.waitForTimeout(500);

    // Should now show 2 accounts - look for the "Switch" button which only appears for non-active accounts
    await expect(page.getByRole('button', { name: 'Switch' })).toBeVisible({ timeout: 5000 });
  });

  test('should show error for invalid nsec', async ({ page }) => {
    await navigateToAccountsPage(page);

    // Click "Add with nsec" button
    await page.getByRole('button', { name: 'Add with nsec' }).click();
    await page.waitForTimeout(200);

    // Enter invalid nsec
    const nsecInput = page.locator('input[placeholder="nsec1..."]');
    await nsecInput.fill('invalid-nsec');
    await page.getByRole('button', { name: 'Add' }).click();
    await page.waitForTimeout(200);

    // Should show error
    await expect(page.getByText('Invalid nsec')).toBeVisible();
  });

  test('should cancel adding nsec account', async ({ page }) => {
    await navigateToAccountsPage(page);

    // Click "Add with nsec" button
    await page.getByRole('button', { name: 'Add with nsec' }).click();
    await page.waitForTimeout(200);

    // Input should be visible
    await expect(page.locator('input[placeholder="nsec1..."]')).toBeVisible();

    // Click Cancel
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.waitForTimeout(200);

    // Input should be hidden
    await expect(page.locator('input[placeholder="nsec1..."]')).not.toBeVisible();
  });

  test('should switch between accounts', async ({ page }) => {
    await navigateToAccountsPage(page);

    // Get initial npub
    const initialNpub = await page.evaluate(() => {
      const accounts = localStorage.getItem('hashtree:accounts');
      if (accounts) {
        const parsed = JSON.parse(accounts);
        return parsed[0]?.npub || '';
      }
      return '';
    });

    // Add a second account
    await page.getByRole('button', { name: 'Add with nsec' }).click();
    await page.locator('input[placeholder="nsec1..."]').fill(generateTestNsec());
    await page.getByRole('button', { name: 'Add' }).click();
    await page.waitForTimeout(500);

    // Should have 2 accounts now - find and click the Switch button
    const switchButton = page.getByRole('button', { name: 'Switch' });
    await expect(switchButton).toBeVisible({ timeout: 5000 });
    await switchButton.click();
    await page.waitForTimeout(1000);

    // Should navigate to the new account's profile
    const newUrl = page.url();
    expect(newUrl).not.toContain(initialNpub);
    expect(newUrl).toContain('npub');
  });

  test('should not allow removing last account', async ({ page }) => {
    await navigateToAccountsPage(page);

    // With only 1 account, the remove button (trash icon) should not be visible
    await expect(page.locator('button[title="Remove account"]')).not.toBeVisible();
  });

  test('should remove account when multiple exist', async ({ page }) => {
    await navigateToAccountsPage(page);

    // Add a second account first
    await page.getByRole('button', { name: 'Add with nsec' }).click();
    await page.locator('input[placeholder="nsec1..."]').fill(generateTestNsec());
    await page.getByRole('button', { name: 'Add' }).click();
    await page.waitForTimeout(500);

    // Should have 2 accounts now
    await expect(page.getByRole('button', { name: 'Switch' })).toBeVisible({ timeout: 5000 });

    // Find the remove button (trash icon) - use first() since both accounts have one
    const removeButton = page.locator('button[title="Remove account"]').first();
    await expect(removeButton).toBeVisible();

    // Click to show confirmation
    await removeButton.click();
    await page.waitForTimeout(300);

    // Should show confirmation buttons - use exact: true to avoid matching "Remove account"
    const confirmRemoveButton = page.getByRole('button', { name: 'Remove', exact: true });
    await expect(confirmRemoveButton).toBeVisible({ timeout: 5000 });

    // Confirm removal
    await confirmRemoveButton.click();
    await page.waitForTimeout(500);

    // Should now have only 1 account - no Switch button visible
    await expect(page.getByRole('button', { name: 'Switch' })).not.toBeVisible({ timeout: 5000 });
  });

  test('should cancel account removal', async ({ page }) => {
    await navigateToAccountsPage(page);

    // Add a second account first
    await page.getByRole('button', { name: 'Add with nsec' }).click();
    await page.locator('input[placeholder="nsec1..."]').fill(generateTestNsec());
    await page.getByRole('button', { name: 'Add' }).click();
    await page.waitForTimeout(500);

    // Find the remove button - use first() since both accounts have one
    const removeButton = page.locator('button[title="Remove account"]').first();
    await removeButton.click();
    await page.waitForTimeout(200);

    // Click Cancel instead of Remove
    await page.getByRole('button', { name: 'Cancel' }).last().click();
    await page.waitForTimeout(200);

    // Should still have 2 accounts - Switch button should be visible
    await expect(page.getByRole('button', { name: 'Switch' })).toBeVisible({ timeout: 5000 });
  });

  test('should go back from accounts page', async ({ page }) => {
    await navigateToAccountsPage(page);

    // Click back button
    await page.getByRole('button', { name: 'Back' }).click();
    await page.waitForTimeout(300);

    // Should be back on profile/tree list page
    expect(page.url()).not.toContain('/accounts');
  });

  test('should persist accounts across page reload', async ({ page }) => {
    await navigateToAccountsPage(page);

    // Add a second account
    await page.getByRole('button', { name: 'Add with nsec' }).click();
    await page.locator('input[placeholder="nsec1..."]').fill(generateTestNsec());
    await page.getByRole('button', { name: 'Add' }).click();
    await page.waitForTimeout(500);

    // Should have 2 accounts
    await expect(page.getByRole('button', { name: 'Switch' })).toBeVisible({ timeout: 5000 });

    // Reload the page
    await page.reload();
    await page.waitForTimeout(500);

    // Navigate back to accounts page
    await page.locator(myTreesButtonSelector).dblclick();
    await page.waitForTimeout(300);

    // Should still have 2 accounts
    await expect(page.getByRole('button', { name: 'Switch' })).toBeVisible({ timeout: 5000 });
  });

  test('should not add duplicate account', async ({ page }) => {
    await navigateToAccountsPage(page);

    const testNsec = generateTestNsec();

    // Add first account
    await page.getByRole('button', { name: 'Add with nsec' }).click();
    await page.locator('input[placeholder="nsec1..."]').fill(testNsec);
    await page.getByRole('button', { name: 'Add' }).click();
    await page.waitForTimeout(500);

    // Should have 2 accounts
    await expect(page.getByRole('button', { name: 'Switch' })).toBeVisible({ timeout: 5000 });

    // Try to add the same account again
    await page.getByRole('button', { name: 'Add with nsec' }).click();
    await page.locator('input[placeholder="nsec1..."]').fill(testNsec);
    await page.getByRole('button', { name: 'Add' }).click();
    await page.waitForTimeout(500);

    // Should show error about duplicate
    await expect(page.getByText('Account already added')).toBeVisible();
  });

  test('should show account type indicator (nsec)', async ({ page }) => {
    await navigateToAccountsPage(page);

    // Should show "nsec" label for the account type
    await expect(page.getByText('nsec').first()).toBeVisible();
  });
});
