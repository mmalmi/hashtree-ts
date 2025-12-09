import { test, expect } from '@playwright/test';
import { setupPageErrorHandler } from './test-utils.js';

test.describe('Mobile Search', () => {
  test.setTimeout(30000);

  test.beforeEach(async ({ page }) => {
    setupPageErrorHandler(page);
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await page.waitForSelector('header span:has-text("hashtree")', { timeout: 5000 });
  });

  test('should show search icon on mobile', async ({ page }) => {
    // On mobile, the search icon should be visible
    await expect(page.locator('header button .i-lucide-search')).toBeVisible();
  });

  test('should expand search when icon is clicked', async ({ page }) => {
    // Click the search icon
    await page.locator('header button .i-lucide-search').click();

    // Search input should now be visible and expanded (first visible one is mobile search)
    await expect(page.locator('header input[placeholder*="Search"]').first()).toBeVisible();
  });

  test('should collapse search when clicking close button', async ({ page }) => {
    // Click the search icon to expand
    await page.locator('header button .i-lucide-search').click();
    await expect(page.locator('header input[placeholder*="Search"]').first()).toBeVisible();

    // Click the close button (X icon)
    await page.locator('header button .i-lucide-x').click();

    // Search should collapse back to icon
    await expect(page.locator('header button .i-lucide-search')).toBeVisible();
  });

  test('should hide search on desktop', async ({ page }) => {
    // Desktop viewport
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.waitForTimeout(100);

    // Regular search should be visible on desktop
    await expect(page.locator('header input[placeholder*="Search"]')).toBeVisible();

    // Mobile search icon should be hidden on desktop
    await expect(page.locator('header button .i-lucide-search').first()).not.toBeVisible();
  });
});
