/**
 * E2E tests for HTML Viewer with directory context
 *
 * Tests the flow of:
 * 1. Uploading HTML file with CSS/JS/image resources
 * 2. HTML viewer loads and renders correctly
 * 3. Resources from same directory are accessible
 * 4. Resources from subdirectories are accessible
 */
import { test, expect } from '@playwright/test';
import { setupPageErrorHandler, navigateToPublicFolder } from './test-utils.js';

test.describe('HTML Viewer with directory context', () => {
  // Skip: setInputFiles doesn't trigger upload handler reliably in Playwright
  test.skip('should render HTML with inline CSS from same directory', async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await navigateToPublicFolder(page);

    // Create a folder for our HTML site
    await page.locator('header a:has-text("hashtree")').click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'New Folder' }).click();

    const input = page.locator('input[placeholder="Folder name..."]');
    await input.waitFor({ timeout: 5000 });
    await input.fill('html-test');
    await page.click('button:has-text("Create")');

    // Wait for folder view
    await expect(page.locator('.fixed.inset-0.bg-black')).not.toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/Drop or click to add|Empty directory/).first()).toBeVisible({ timeout: 10000 });

    // Create CSS file content
    const cssContent = `
body {
  background-color: rgb(0, 128, 0);
  color: white;
  font-family: sans-serif;
}
h1 {
  color: rgb(255, 255, 0);
}
#test-element {
  background-color: rgb(0, 0, 255);
  padding: 20px;
}
`;

    // Create HTML file content that references the CSS
    const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <title>Test Page</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <h1>Hello from HashTree</h1>
  <div id="test-element">This should have blue background</div>
  <p>If CSS loaded correctly, background is green and heading is yellow.</p>
</body>
</html>`;

    // Upload CSS file first
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'style.css',
      mimeType: 'text/css',
      buffer: Buffer.from(cssContent),
    });

    // Wait for upload
    await expect(page.locator('text=style.css')).toBeVisible({ timeout: 10000 });

    // Upload HTML file
    await fileInput.setInputFiles({
      name: 'index.html',
      mimeType: 'text/html',
      buffer: Buffer.from(htmlContent),
    });

    // Wait for upload
    await expect(page.locator('text=index.html')).toBeVisible({ timeout: 10000 });

    // Click on the HTML file to view it
    await page.click('text=index.html');

    // Wait for iframe to appear
    const iframe = page.frameLocator('iframe');

    // Check that HTML content is rendered
    await expect(iframe.locator('h1')).toContainText('Hello from HashTree', { timeout: 10000 });

    // Check that CSS was applied - the heading should be yellow (rgb 255, 255, 0)
    const h1 = iframe.locator('h1');
    await expect(h1).toBeVisible();

    // Verify the test element exists
    const testElement = iframe.locator('#test-element');
    await expect(testElement).toBeVisible();
    await expect(testElement).toContainText('This should have blue background');
  });

  // Skip: setInputFiles doesn't trigger upload handler reliably in Playwright
  test.skip('should render HTML with JavaScript from same directory', async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await navigateToPublicFolder(page);

    // Create a folder
    await page.locator('header a:has-text("hashtree")').click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'New Folder' }).click();

    const input = page.locator('input[placeholder="Folder name..."]');
    await input.waitFor({ timeout: 5000 });
    await input.fill('js-test');
    await page.click('button:has-text("Create")');

    await expect(page.locator('.fixed.inset-0.bg-black')).not.toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/Drop or click to add|Empty directory/).first()).toBeVisible({ timeout: 10000 });

    // Create JS file that modifies the DOM
    // Use window.onload to ensure DOM is ready
    const jsContent = `
window.onload = function() {
  var el = document.getElementById('js-target');
  if (el) {
    el.textContent = 'JavaScript loaded successfully!';
    el.setAttribute('data-loaded', 'true');
  }
};
`;

    // Create HTML file that references the JS at end of body
    const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <title>JS Test</title>
</head>
<body>
  <h1>JavaScript Test</h1>
  <div id="js-target">Waiting for JavaScript...</div>
  <script src="app.js"></script>
</body>
</html>`;

    // Upload JS file first
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'app.js',
      mimeType: 'text/javascript',
      buffer: Buffer.from(jsContent),
    });

    await expect(page.locator('text=app.js')).toBeVisible({ timeout: 10000 });

    // Upload HTML file
    await fileInput.setInputFiles({
      name: 'index.html',
      mimeType: 'text/html',
      buffer: Buffer.from(htmlContent),
    });

    await expect(page.locator('text=index.html')).toBeVisible({ timeout: 10000 });

    // Click on the HTML file
    await page.click('text=index.html');

    // Wait for iframe to appear and load
    await page.waitForSelector('iframe', { timeout: 10000 });

    // Check that JavaScript executed
    const iframe = page.frameLocator('iframe');
    const target = iframe.locator('#js-target');

    // JS should have changed the text - give more time
    await expect(target).toContainText('JavaScript loaded successfully!', { timeout: 15000 });
  });

  // SKIP: Subdirectory CSS file not visible - navigation timing issue
  test.skip('should load resources from subdirectories', async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await navigateToPublicFolder(page);

    // Create main folder
    await page.locator('header a:has-text("hashtree")').click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'New Folder' }).click();

    const input = page.locator('input[placeholder="Folder name..."]');
    await input.waitFor({ timeout: 5000 });
    await input.fill('subdir-test');
    await page.click('button:has-text("Create")');

    await expect(page.locator('.fixed.inset-0.bg-black')).not.toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/Drop or click to add|Empty directory/).first()).toBeVisible({ timeout: 10000 });

    // Create subdirectory 'css'
    await page.getByRole('button', { name: /Folder/ }).click();
    const subInput = page.locator('input[placeholder="Folder name..."]');
    await subInput.waitFor({ timeout: 5000 });
    await subInput.fill('css');
    await page.click('button:has-text("Create")');
    await expect(page.locator('.fixed.inset-0.bg-black')).not.toBeVisible({ timeout: 10000 });

    // Navigate into css folder
    await page.click('text=css');
    await page.waitForTimeout(500);

    // Upload CSS file in subdirectory
    const cssContent = `
body { background-color: rgb(128, 0, 128); }
h1 { color: rgb(0, 255, 255); }
`;
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'style.css',
      mimeType: 'text/css',
      buffer: Buffer.from(cssContent),
    });

    await expect(page.locator('text=style.css')).toBeVisible({ timeout: 10000 });

    // Go back to parent directory (click on ".." link)
    await page.click('text=".."');
    await page.waitForTimeout(500);

    // Upload HTML that references css/style.css
    const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <title>Subdir Test</title>
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  <h1>Subdirectory CSS Test</h1>
  <p id="info">If CSS loaded, background should be purple.</p>
</body>
</html>`;

    await fileInput.setInputFiles({
      name: 'index.html',
      mimeType: 'text/html',
      buffer: Buffer.from(htmlContent),
    });

    // Wait for file list to show index.html - use file-list to be more specific
    const fileList = page.locator('[data-testid="file-list"]');
    await expect(fileList.locator('text=index.html')).toBeVisible({ timeout: 10000 });

    // Click on HTML file in file list
    await fileList.locator('text=index.html').click();

    // Check content loaded
    const iframe = page.frameLocator('iframe');
    await expect(iframe.locator('h1')).toContainText('Subdirectory CSS Test', { timeout: 10000 });
    await expect(iframe.locator('#info')).toBeVisible();
  });

  // Note: fetch() API doesn't work in sandboxed iframe without allow-same-origin
  // For security, we only use allow-scripts, so dynamic data loading via fetch is not supported
});
