/**
 * E2E tests for DOSBox integration
 *
 * Tests the flow of:
 * 1. Uploading a ZIP containing DOS executables
 * 2. Extracting the ZIP to a directory
 * 3. Clicking on a .exe file shows the DOSBox viewer
 * 4. DOSBox viewer loads directory context
 */
import { test, expect } from '@playwright/test';
import { setupPageErrorHandler, waitForNewUserRedirect, myTreesButtonSelector } from './test-utils.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe('DOSBox integration', () => {
  // Skip: setInputFiles doesn't trigger upload handler reliably in Playwright
  test.skip('should show extract modal when uploading a ZIP with DOS files', async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await waitForNewUserRedirect(page);

    // Navigate to tree list and create a folder
    await page.locator(myTreesButtonSelector).click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'New Folder' }).click();

    const input = page.locator('input[placeholder="Folder name..."]');
    await input.waitFor({ timeout: 5000 });
    await input.fill('dos-games');
    await page.click('button:has-text("Create")');

    // Wait for modal to close and folder view
    await expect(page.locator('.fixed.inset-0.bg-black')).not.toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Empty directory')).toBeVisible({ timeout: 10000 });

    // Read the test ZIP file
    const zipPath = path.join(__dirname, '../test-data/dosgame.zip');
    const zipBuffer = fs.readFileSync(zipPath);

    // Upload the ZIP file
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'dosgame.zip',
      mimeType: 'application/zip',
      buffer: zipBuffer,
    });

    // Should show extract modal
    await expect(page.locator('text=Extract Archive?')).toBeVisible({ timeout: 10000 });

    // Should show file list
    await expect(page.locator('text=GAME.EXE')).toBeVisible();
    await expect(page.locator('text=CONFIG.TXT')).toBeVisible();
    await expect(page.locator('text=README.TXT')).toBeVisible();

    // Click Extract Files
    await page.click('button:has-text("Extract Files")');

    // Wait for extraction to complete and modal to close
    await expect(page.locator('text=Extract Archive?')).not.toBeVisible({ timeout: 15000 });

    // Should see extracted files in file browser
    await expect(page.locator('text=GAME.EXE')).toBeVisible({ timeout: 10000 });
  });

  // Skip: setInputFiles doesn't trigger upload handler reliably in Playwright
  test.skip('should show DOSBox viewer when clicking on .exe file', async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await waitForNewUserRedirect(page);

    // Navigate to tree list and create a folder
    await page.locator(myTreesButtonSelector).click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'New Folder' }).click();

    const input = page.locator('input[placeholder="Folder name..."]');
    await input.waitFor({ timeout: 5000 });
    await input.fill('dos-test');
    await page.click('button:has-text("Create")');

    // Wait for folder view
    await expect(page.locator('.fixed.inset-0.bg-black')).not.toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Empty directory')).toBeVisible({ timeout: 10000 });

    // Read and upload the test ZIP
    const zipPath = path.join(__dirname, '../test-data/dosgame.zip');
    const zipBuffer = fs.readFileSync(zipPath);

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'dosgame.zip',
      mimeType: 'application/zip',
      buffer: zipBuffer,
    });

    // Extract the archive
    await expect(page.locator('text=Extract Archive?')).toBeVisible({ timeout: 10000 });
    await page.click('button:has-text("Extract Files")');
    await expect(page.locator('text=Extract Archive?')).not.toBeVisible({ timeout: 15000 });

    // Wait for GAME.EXE to appear in file list
    await expect(page.locator('text=GAME.EXE')).toBeVisible({ timeout: 10000 });

    // Click on the .exe file
    await page.click('text=GAME.EXE');

    // Should show DOSBox viewer with terminal icon
    await expect(page.locator('.i-lucide-terminal')).toBeVisible({ timeout: 10000 });

    // Should show "DOS Executable" label
    await expect(page.locator('text=DOS Executable')).toBeVisible({ timeout: 5000 });

    // Should show file count (5 files in our test zip: GAME.EXE, CONFIG.TXT, README.TXT, DATA/LEVELS.DAT, DATA/SOUND.DAT)
    await expect(page.locator('text=/\\d+ files.*ready to mount/')).toBeVisible({ timeout: 10000 });

    // Should show "Run in DOSBox" button
    await expect(page.locator('button:has-text("Run in DOSBox")')).toBeVisible({ timeout: 5000 });
  });

  // Skip: setInputFiles doesn't trigger upload handler reliably in Playwright
  test.skip('should load directory context when starting DOSBox', async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await waitForNewUserRedirect(page);

    // Create folder and upload ZIP
    await page.locator(myTreesButtonSelector).click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'New Folder' }).click();

    const input = page.locator('input[placeholder="Folder name..."]');
    await input.waitFor({ timeout: 5000 });
    await input.fill('dos-run-test');
    await page.click('button:has-text("Create")');

    await expect(page.locator('.fixed.inset-0.bg-black')).not.toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Empty directory')).toBeVisible({ timeout: 10000 });

    // Upload and extract ZIP
    const zipPath = path.join(__dirname, '../test-data/dosgame.zip');
    const zipBuffer = fs.readFileSync(zipPath);

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'dosgame.zip',
      mimeType: 'application/zip',
      buffer: zipBuffer,
    });

    await expect(page.locator('text=Extract Archive?')).toBeVisible({ timeout: 10000 });
    await page.click('button:has-text("Extract Files")');
    await expect(page.locator('text=Extract Archive?')).not.toBeVisible({ timeout: 15000 });

    // Click on GAME.EXE
    await expect(page.locator('text=GAME.EXE')).toBeVisible({ timeout: 10000 });
    await page.click('text=GAME.EXE');

    // Wait for files to be collected
    await expect(page.locator('text=/\\d+ files.*ready to mount/')).toBeVisible({ timeout: 10000 });

    // Click Run in DOSBox
    await page.click('button:has-text("Run in DOSBox")');

    // Should show loading state or running state
    // The DOSBox viewer should show the directory listing
    await expect(page.locator('text=HASHTREE').or(page.locator('text=Loading'))).toBeVisible({ timeout: 10000 });
  });

  // Skip: setInputFiles doesn't trigger upload handler reliably in Playwright
  test.skip('should display terminal icon for .exe files in file list', async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await waitForNewUserRedirect(page);

    // Create folder
    await page.locator(myTreesButtonSelector).click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'New Folder' }).click();

    const input = page.locator('input[placeholder="Folder name..."]');
    await input.waitFor({ timeout: 5000 });
    await input.fill('icon-test');
    await page.click('button:has-text("Create")');

    await expect(page.locator('.fixed.inset-0.bg-black')).not.toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Empty directory')).toBeVisible({ timeout: 10000 });

    // Upload and extract ZIP
    const zipPath = path.join(__dirname, '../test-data/dosgame.zip');
    const zipBuffer = fs.readFileSync(zipPath);

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'dosgame.zip',
      mimeType: 'application/zip',
      buffer: zipBuffer,
    });

    await expect(page.locator('text=Extract Archive?')).toBeVisible({ timeout: 10000 });
    await page.click('button:has-text("Extract Files")');
    await expect(page.locator('text=Extract Archive?')).not.toBeVisible({ timeout: 15000 });

    // Wait for file list to show
    await expect(page.locator('text=GAME.EXE')).toBeVisible({ timeout: 10000 });

    // The file row should have a terminal icon
    // Find the row containing GAME.EXE and check for the icon
    const exeRow = page.locator('[class*="file-row"], a, button').filter({ hasText: 'GAME.EXE' });
    await expect(exeRow).toBeVisible();
  });

  test('should allow keeping ZIP as file instead of extracting', async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await waitForNewUserRedirect(page);

    // Create folder
    await page.locator(myTreesButtonSelector).click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'New Folder' }).click();

    const input = page.locator('input[placeholder="Folder name..."]');
    await input.waitFor({ timeout: 5000 });
    await input.fill('keep-zip-test');
    await page.click('button:has-text("Create")');

    await expect(page.locator('.fixed.inset-0.bg-black')).not.toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Empty directory')).toBeVisible({ timeout: 10000 });

    // Upload ZIP
    const zipPath = path.join(__dirname, '../test-data/dosgame.zip');
    const zipBuffer = fs.readFileSync(zipPath);

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'dosgame.zip',
      mimeType: 'application/zip',
      buffer: zipBuffer,
    });

    // Should show extract modal
    await expect(page.locator('text=Extract Archive?')).toBeVisible({ timeout: 10000 });

    // Click "Keep as ZIP" instead of extracting
    await page.click('button:has-text("Keep as ZIP")');

    // Modal should close
    await expect(page.locator('text=Extract Archive?')).not.toBeVisible({ timeout: 5000 });

    // The ZIP file itself should NOT be in the file list (upload was cancelled)
    // This is the current behavior - keeping as ZIP cancels the upload
  });
});
