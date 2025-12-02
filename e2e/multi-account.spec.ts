import { test, expect } from '@playwright/test';

// Helper to wait for new user redirect to complete
async function waitForNewUserRedirect(page: any) {
  await page.waitForURL(/\/#\/npub.*\/home/, { timeout: 10000 });
  await expect(page.getByRole('button', { name: /File/ }).first()).toBeVisible({ timeout: 10000 });
}

// Filter out rate-limit errors from relay
function setupPageErrorHandler(page: any) {
  page.on('pageerror', (err: Error) => {
    if (!err.message.includes('rate-limited')) {
      console.log('Page error:', err.message);
    }
  });
}

// Helper to navigate to accounts page
async function navigateToAccountsPage(page: any) {
  // First go to profile
  await page.locator('header button[title="My Trees"]').click();
  await page.waitForTimeout(300);

  // Click the accounts/users button
  await page.locator('button[title="Switch account"]').click();
  await page.waitForTimeout(300);

  // Should be on accounts page
  await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible({ timeout: 5000 });
}

// Helper to get the current user's npub from URL or page
async function getCurrentNpub(page: any): Promise<string> {
  const url = page.url();
  const match = url.match(/#\/(npub[^/]+)/);
  if (match) return match[1];

  // Try to get from localStorage
  const npub = await page.evaluate(() => {
    const nsec = localStorage.getItem('hashtree:nsec');
    if (!nsec) return null;
    // Can't decode here, but we can get active account
    const accounts = localStorage.getItem('hashtree:accounts');
    if (accounts) {
      const parsed = JSON.parse(accounts);
      if (parsed.length > 0) return parsed[0].npub;
    }
    return null;
  });

  return npub || '';
}

// Generate a test nsec for adding accounts
function generateTestNsec(): string {
  // This is a deterministic nsec for testing purposes only
  // In real usage, this would be a real private key
  // nsec1... format - 63 chars total, starts with nsec1
  // Using a hardcoded test key that's valid but not used for real funds
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

  test('should display accounts button on own profile', async ({ page }) => {
    // Navigate to profile
    await page.locator('header button[title="My Trees"]').click();
    await page.waitForTimeout(300);

    // Should see the accounts button (users icon)
    await expect(page.locator('button[title="Switch account"]')).toBeVisible({ timeout: 5000 });
  });

  test('should navigate to accounts page from profile', async ({ page }) => {
    await navigateToAccountsPage(page);

    // Verify accounts page elements
    await expect(page.getByText('Current Account')).toBeVisible();
    await expect(page.getByText(/All Accounts \(\d+\)/)).toBeVisible();
    await expect(page.getByText('Add Account')).toBeVisible();
  });

  test('should show initial auto-generated account', async ({ page }) => {
    await navigateToAccountsPage(page);

    // Should show 1 account initially (auto-generated) - using regex for flexibility
    await expect(page.getByText(/All Accounts \(1\)/)).toBeVisible({ timeout: 5000 });

    // Current account should be shown with check mark
    await expect(page.locator('span.i-lucide-check-circle').first()).toBeVisible();
  });

  test('should add account with nsec', async ({ page }) => {
    await navigateToAccountsPage(page);

    // Initial state: 1 account
    await expect(page.getByText('All Accounts (1)')).toBeVisible({ timeout: 5000 });

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

    // Should now show 2 accounts
    await expect(page.getByText('All Accounts (2)')).toBeVisible({ timeout: 5000 });
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

    // Should have 2 accounts
    await expect(page.getByText('All Accounts (2)')).toBeVisible({ timeout: 5000 });

    // Find and click the Switch button for the other account
    const switchButton = page.getByRole('button', { name: 'Switch' });
    await expect(switchButton).toBeVisible({ timeout: 5000 });
    await switchButton.click();
    await page.waitForTimeout(1000);

    // Should navigate to the new account's profile
    const newUrl = page.url();
    expect(newUrl).not.toContain(initialNpub);
    expect(newUrl).toContain('npub');
  });

  test('should not remove last account', async ({ page }) => {
    await navigateToAccountsPage(page);

    // Should have 1 account
    await expect(page.getByText('All Accounts (1)')).toBeVisible({ timeout: 5000 });

    // The remove button should not be visible for the only account
    // (because canRemove is false when only 1 account)
    await expect(page.locator('button[title="Remove account"]')).not.toBeVisible();
  });

  test('should remove account when multiple exist', async ({ page }) => {
    await navigateToAccountsPage(page);

    // Add a second account first
    await page.getByRole('button', { name: 'Add with nsec' }).click();
    await page.locator('input[placeholder="nsec1..."]').fill(generateTestNsec());
    await page.getByRole('button', { name: 'Add' }).click();
    await page.waitForTimeout(500);

    // Should have 2 accounts
    await expect(page.getByText(/All Accounts \(2\)/)).toBeVisible({ timeout: 5000 });

    // Verify 2 accounts in localStorage
    const accountsBefore = await page.evaluate(() => {
      const data = localStorage.getItem('hashtree:accounts');
      return data ? JSON.parse(data).length : 0;
    });
    expect(accountsBefore).toBe(2);

    // Find the remove button (trash icon) - it should exist for non-active accounts
    const removeButtons = page.locator('button[title="Remove account"]');
    const removeButtonCount = await removeButtons.count();
    expect(removeButtonCount).toBeGreaterThan(0);

    // Click the first remove button
    await removeButtons.first().click();
    await page.waitForTimeout(300);

    // Should show confirmation - look for "Remove" text button
    // The button has classes "btn-ghost p-1 text-xs text-danger"
    const confirmRemoveButton = page.locator('button:has-text("Remove")').filter({ hasText: /^Remove$/ });
    await expect(confirmRemoveButton).toBeVisible({ timeout: 5000 });

    // Confirm removal
    await confirmRemoveButton.click();
    await page.waitForTimeout(1000);

    // Verify only 1 account remains in localStorage
    const accountsAfter = await page.evaluate(() => {
      const data = localStorage.getItem('hashtree:accounts');
      return data ? JSON.parse(data).length : 0;
    });
    expect(accountsAfter).toBe(1);
  });

  test('should cancel account removal', async ({ page }) => {
    await navigateToAccountsPage(page);

    // Add a second account first
    await page.getByRole('button', { name: 'Add with nsec' }).click();
    await page.locator('input[placeholder="nsec1..."]').fill(generateTestNsec());
    await page.getByRole('button', { name: 'Add' }).click();
    await page.waitForTimeout(500);

    // Find the remove button
    const removeButton = page.locator('button[title="Remove account"]').first();
    await removeButton.click();
    await page.waitForTimeout(200);

    // Click Cancel instead of Remove
    await page.locator('button:has-text("Cancel")').last().click();
    await page.waitForTimeout(200);

    // Should still have 2 accounts
    await expect(page.getByText('All Accounts (2)')).toBeVisible({ timeout: 5000 });
  });

  test('should go back from accounts page', async ({ page }) => {
    await navigateToAccountsPage(page);

    // Click back button
    await page.locator('button:has(span.i-lucide-arrow-left)').click();
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
    await expect(page.getByText('All Accounts (2)')).toBeVisible({ timeout: 5000 });

    // Reload the page
    await page.reload();
    await page.waitForTimeout(500);

    // Navigate back to accounts page
    await page.locator('header button[title="My Trees"]').click();
    await page.waitForTimeout(300);
    await page.locator('button[title="Switch account"]').click();
    await page.waitForTimeout(300);

    // Should still have 2 accounts
    await expect(page.getByText('All Accounts (2)')).toBeVisible({ timeout: 5000 });
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
    await expect(page.getByText('All Accounts (2)')).toBeVisible({ timeout: 5000 });

    // Try to add the same account again
    await page.getByRole('button', { name: 'Add with nsec' }).click();
    await page.locator('input[placeholder="nsec1..."]').fill(testNsec);
    await page.getByRole('button', { name: 'Add' }).click();
    await page.waitForTimeout(500);

    // Should show error about duplicate
    await expect(page.getByText('Account already added')).toBeVisible();

    // Should still have only 2 accounts
    await expect(page.getByText('All Accounts (2)')).toBeVisible({ timeout: 5000 });
  });

  test('should show account type indicator (nsec)', async ({ page }) => {
    await navigateToAccountsPage(page);

    // Add an nsec account
    await page.getByRole('button', { name: 'Add with nsec' }).click();
    await page.locator('input[placeholder="nsec1..."]').fill(generateTestNsec());
    await page.getByRole('button', { name: 'Add' }).click();
    await page.waitForTimeout(500);

    // Should show "nsec" label for the account type
    await expect(page.getByText('nsec').first()).toBeVisible();
  });

  test('should show current account at top', async ({ page }) => {
    await navigateToAccountsPage(page);

    // Current Account section should be visible at top
    await expect(page.getByText('Current Account')).toBeVisible();

    // Should show avatar in current account section - use first() to avoid strict mode
    const currentAccountSection = page.locator('.bg-surface-1.rounded-lg').first();
    await expect(currentAccountSection.locator('img').first()).toBeVisible();
  });

  test('should not show accounts button on other user profiles', async ({ page, browser }) => {
    // Get current user's npub
    await page.locator('header button[title="My Trees"]').click();
    await page.waitForTimeout(300);

    const currentUrl = page.url();
    const match = currentUrl.match(/#\/(npub[^/]+)/);
    expect(match).toBeTruthy();
    const myNpub = match![1];

    // Create a second browser context to simulate another user
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    setupPageErrorHandler(page2);

    await page2.goto('/');
    await page2.evaluate(async () => {
      const dbs = await indexedDB.databases();
      for (const db of dbs) {
        if (db.name) indexedDB.deleteDatabase(db.name);
      }
      localStorage.clear();
      sessionStorage.clear();
    });
    await page2.reload();
    await page2.waitForTimeout(500);
    await page2.waitForSelector('header span:has-text("Hashtree")', { timeout: 5000 });
    await waitForNewUserRedirect(page2);

    // Navigate to first user's profile from second user's perspective
    await page2.goto(`/#/${myNpub}`);
    await page2.waitForTimeout(1000);

    // Should NOT see the accounts button (not own profile)
    await expect(page2.locator('button[title="Switch account"]')).not.toBeVisible();

    // But should see Follow button (other user's profile) - use exact match to avoid "Following"
    await expect(page2.getByRole('button', { name: 'Follow', exact: true })).toBeVisible({ timeout: 5000 });

    await context2.close();
  });
});
