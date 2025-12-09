import { test, expect } from '@playwright/test';

test.describe('Social graph features', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Login with new account
    await page.getByRole('button', { name: /New/i }).click();
    await page.waitForTimeout(1500);
  });

  // Helper to close any open modals
  async function closeModals(page) {
    for (let i = 0; i < 3; i++) {
      const backdrop = page.locator('.fixed.inset-0');
      if (await backdrop.first().isVisible({ timeout: 300 }).catch(() => false)) {
        await backdrop.first().click({ position: { x: 5, y: 5 }, force: true });
        await page.waitForTimeout(300);
      } else {
        break;
      }
    }
  }

  // Helper to navigate to own profile
  async function goToOwnProfile(page) {
    await closeModals(page);
    // Click on the avatar button in header (title: "My Profile")
    const avatarButton = page.getByTitle('My Profile (double-click for users)');
    if (await avatarButton.isVisible({ timeout: 1000 }).catch(() => false)) {
      await avatarButton.click();
    }
    await page.waitForTimeout(500);
    await closeModals(page);
  }

  test.describe('ProfileView badges', () => {
    test('should show "You" badge on own profile', async ({ page }) => {
      await goToOwnProfile(page);

      // Should show "You" badge
      const youBadge = page.locator('text=You').first();
      await expect(youBadge).toBeVisible();
    });

    test('should show following count', async ({ page }) => {
      await goToOwnProfile(page);

      // Should show following count (may be 0 or ...)
      const followingButton = page.getByRole('button', { name: /Following/i });
      await expect(followingButton).toBeVisible();
    });
  });

  test.describe('Follow/unfollow', () => {
    // Note: Testing follow/unfollow requires another user's profile
    // For now we just verify the UI structure on own profile
    test('should not show follow/unfollow button on own profile', async ({ page }) => {
      await goToOwnProfile(page);

      // Should NOT have a follow or unfollow button on own profile (exact match)
      const followButton = page.getByRole('button', { name: 'Follow', exact: true });
      const unfollowButton = page.getByRole('button', { name: 'Unfollow', exact: true });
      await expect(followButton).not.toBeVisible();
      await expect(unfollowButton).not.toBeVisible();
    });

    test('should show Edit Profile button on own profile', async ({ page }) => {
      await goToOwnProfile(page);

      // Should show Edit Profile button
      const editButton = page.getByRole('button', { name: 'Edit Profile' });
      await expect(editButton).toBeVisible();
    });
  });
});
