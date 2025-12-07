import { test } from '@playwright/test';
import { setupPageErrorHandler, navigateToPublicFolder } from './test-utils.js';

test('take screenshot of git repo view', async ({ page }) => {
  setupPageErrorHandler(page);
  await page.goto('/');
  await navigateToPublicFolder(page);

  const folderInput = page.locator('input[placeholder="Folder name..."]');
  const fileInput = page.locator('input[placeholder="File name..."]');
  const textarea = page.locator('textarea');

  // Create .git folder
  await page.getByRole('button', { name: 'New Folder' }).click();
  await folderInput.waitFor({ timeout: 5000 });
  await folderInput.fill('.git');
  await page.click('button:has-text("Create")');
  await page.waitForTimeout(500);

  // Navigate into .git and create HEAD file
  await page.locator('[data-testid="file-list"] a').filter({ hasText: '.git' }).first().click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'New File' }).click();
  await fileInput.waitFor({ timeout: 5000 });
  await fileInput.fill('HEAD');
  await page.click('button:has-text("Create")');
  await page.waitForTimeout(500);
  await textarea.waitFor({ timeout: 5000 });
  await textarea.fill('ref: refs/heads/main');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(500);

  // Navigate back to public by clicking ".." in file browser
  await page.locator('[data-testid="file-list"] a').filter({ hasText: '..' }).first().click();
  await page.waitForTimeout(500);

  // Create README.md
  await page.getByRole('button', { name: 'New File' }).click();
  await fileInput.waitFor({ timeout: 5000 });
  await fileInput.fill('README.md');
  await page.click('button:has-text("Create")');
  await page.waitForTimeout(500);
  await textarea.waitFor({ timeout: 5000 });
  await textarea.fill('# Test Repository\n\nThis is a test repository.\n\n## Features\n\n- Git integration\n- File listing\n');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(500);

  // Navigate back to public directory by clicking on "public" in sidebar
  await page.getByRole('link', { name: 'public' }).first().click();
  await page.waitForTimeout(1000);

  // Take screenshot
  await page.screenshot({ path: 'screenshot.png', fullPage: true });
});
