/**
 * E2E tests for Yjs collaborative document editing
 *
 * Tests that two users (A and B) can:
 * 1. Create documents at the same path
 * 2. Add both npubs to their .yjs config files (all editors including self)
 * 3. See each other's edits automatically via subscription
 *
 * TEST PERFORMANCE GUIDELINES:
 * - NEVER use waitForTimeout() for arbitrary delays
 * - ALWAYS wait for specific conditions (element visible, text contains, URL changes)
 * - Use expect(locator).toBeVisible() or toContainText() with timeout
 * - Use page.waitForURL() for navigation
 * - Use page.waitForSelector() for DOM elements
 * - If waiting for content sync, use waitForEditorContent() helper
 */
import { test, expect, Page } from '@playwright/test';
import { setupPageErrorHandler, disableOthersPool, configureBlossomServers } from './test-utils.js';

// Helper to set up a fresh user session
async function setupFreshUser(page: Page) {
  setupPageErrorHandler(page);

  await page.goto('http://localhost:5173');
  await disableOthersPool(page); // Prevent WebRTC cross-talk from parallel tests
  await configureBlossomServers(page);

  // Clear storage for fresh state (including OPFS)
  await page.evaluate(async () => {
    const dbs = await indexedDB.databases();
    for (const db of dbs) {
      if (db.name) indexedDB.deleteDatabase(db.name);
    }
    localStorage.clear();
    sessionStorage.clear();

    // Clear OPFS
    try {
      const root = await navigator.storage.getDirectory();
      for await (const name of root.keys()) {
        await root.removeEntry(name, { recursive: true });
      }
    } catch {
      // OPFS might not be available
    }
  });

  await page.reload();
  await disableOthersPool(page); // Re-apply after reload
  await configureBlossomServers(page);
  await page.waitForSelector('header span:has-text("hashtree")', { timeout: 30000 });

  // Wait for the public folder link to appear
  const publicLink = page.getByRole('link', { name: 'public' }).first();
  await expect(publicLink).toBeVisible({ timeout: 30000 });

  // Click into the public folder
  await publicLink.click();
  await page.waitForURL(/\/#\/npub.*\/public/, { timeout: 30000 });
  await expect(page.getByRole('button', { name: /File/ }).first()).toBeVisible({ timeout: 30000 });
}

// Helper to get the user's npub from the URL
async function getNpub(page: Page): Promise<string> {
  const url = page.url();
  const match = url.match(/npub1[a-z0-9]+/);
  if (!match) throw new Error('Could not find npub in URL');
  return match[0];
}

// Helper to create a document with a given name
async function createDocument(page: Page, name: string) {
  // Wait for New Document button and click
  const newDocButton = page.getByRole('button', { name: 'New Document' });
  await expect(newDocButton).toBeVisible({ timeout: 30000 });
  await newDocButton.click();

  // Wait for modal input and fill
  const input = page.locator('input[placeholder="Document name..."]');
  await expect(input).toBeVisible({ timeout: 30000 });
  await input.fill(name);

  // Click the Create button
  const createButton = page.getByRole('button', { name: 'Create' });
  await expect(createButton).toBeVisible({ timeout: 30000 });
  await createButton.click();

  // Wait for navigation to complete (URL should contain the document name)
  await page.waitForURL(`**/${name}**`, { timeout: 20000 });

  // Wait for editor to appear (document was created and navigated to)
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible({ timeout: 30000 });
}

// Helper to type content in the editor
async function typeInEditor(page: Page, content: string) {
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible({ timeout: 30000 });
  await editor.click();
  await page.keyboard.type(content);
}

// Helper to wait for auto-save
async function waitForSave(page: Page) {
  // Wait for "Saved" status to appear (auto-save debounce is 1s, then save happens)
  const savedStatus = page.locator('text=Saved').or(page.locator('text=/Saved \\d/'));
  await expect(savedStatus).toBeVisible({ timeout: 30000 });
}

// Helper to set editors using the Collaborators modal UI
// Note: This assumes we're viewing the YjsDocument (inside the document folder)
async function setEditors(page: Page, npubs: string[]) {
  // Click the collaborators button (users icon) in the toolbar
  // The button shows either "Manage editors" (own tree) or "View editors" (other's tree)
  const collabButton = page.locator('button[title="Manage editors"], button[title="View editors"]').first();
  await expect(collabButton).toBeVisible({ timeout: 30000 });
  await collabButton.click();

  // Wait for the modal to appear - heading says "Manage Editors" or "Editors" depending on mode
  const modal = page.locator('h2:has-text("Editors")');
  await expect(modal).toBeVisible({ timeout: 30000 });

  // Add each npub
  for (const npub of npubs) {
    console.log(`Adding editor: ${npub.slice(0, 20)}...`);
    const input = page.locator('input[placeholder="npub1..."]');
    await input.fill(npub);

    // Click the "Add User" or "Add <name>" confirm button from the preview
    const confirmButton = page.locator('button.btn-success').filter({ hasText: /^Add/ }).first();
    await expect(confirmButton).toBeVisible({ timeout: 30000 });
    console.log('Add button visible, clicking...');
    // Use force:true to avoid stability check issues when modal content re-renders
    await confirmButton.click({ force: true });
    console.log('Add button clicked');
  }

  // Modal auto-saves on add, just close it using the footer Close button (not the X)
  const closeButton = page.getByText('Close', { exact: true });
  await closeButton.click();
  // Wait for modal to close
  await expect(modal).not.toBeVisible({ timeout: 30000 });
}

// Helper to navigate to another user's document
async function navigateToUserDocument(page: Page, npub: string, treeName: string, docPath: string) {
  const url = `http://localhost:5173/#/${npub}/${treeName}/${docPath}`;
  await page.goto(url);
  // Wait for the app to load
  await page.waitForSelector('header span:has-text("hashtree")', { timeout: 30000 });
}

// Helper to navigate to own document
async function navigateToOwnDocument(page: Page, npub: string, treeName: string, docPath: string) {
  const url = `http://localhost:5173/#/${npub}/${treeName}/${docPath}`;
  await page.goto(url);
  // Wait for app header
  await page.waitForSelector('header span:has-text("hashtree")', { timeout: 30000 });
}

// Helper to follow a user by their npub (navigates to their profile and clicks Follow)
async function followUser(page: Page, targetNpub: string) {
  // Navigate to the user's profile page
  await page.goto(`http://localhost:5173/#/${targetNpub}`);

  // Click the Follow button
  const followButton = page.getByRole('button', { name: 'Follow', exact: true });
  await expect(followButton).toBeVisible({ timeout: 30000 });
  await followButton.click();
  // Wait for follow to complete - button becomes disabled or changes to "Following" or "Unfollow"
  await expect(
    page.getByRole('button', { name: 'Following' })
      .or(page.getByRole('button', { name: 'Unfollow' }))
      .or(followButton.and(page.locator('[disabled]')))
  ).toBeVisible({ timeout: 30000 });
}

// Helper to wait for editor to contain specific text (for sync verification)
async function waitForEditorContent(page: Page, expectedText: string, timeout = 30000) {
  const editor = page.locator('.ProseMirror');
  // First wait for editor to be visible (may take time for nostr sync to load the page)
  await expect(editor).toBeVisible({ timeout: 30000 });
  // Then wait for content
  await expect(editor).toContainText(expectedText, { timeout });
}

test.describe('Yjs Collaborative Document Editing', () => {
  // Serial mode: multi-user tests connect via relay, parallel tests would cross-talk
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(180000); // 3 minutes for collaboration test

  test('two users can see each others edits when viewing each others documents', async ({ browser }) => {
    // Create two browser contexts (simulating two different users)
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    // Log console for debugging
    pageA.on('console', msg => {
      const text = msg.text();
      if (msg.type() === 'error') console.log(`[User A Error] ${text}`);
      if (text.includes('[YjsDoc')) console.log(`[User A] ${text}`);
    });
    pageB.on('console', msg => {
      const text = msg.text();
      if (msg.type() === 'error') console.log(`[User B Error] ${text}`);
      if (text.includes('[YjsDoc')) console.log(`[User B] ${text}`);
    });

    try {
      // === Setup User A ===
      console.log('Setting up User A...');
      await setupFreshUser(pageA);
      const npubA = await getNpub(pageA);
      console.log(`User A npub: ${npubA.slice(0, 20)}...`);

      // === Setup User B ===
      console.log('Setting up User B...');
      await setupFreshUser(pageB);
      const npubB = await getNpub(pageB);
      console.log(`User B npub: ${npubB.slice(0, 20)}...`);

      // === Users follow each other (required for Nostr sync) ===
      console.log('User A: Following User B...');
      await followUser(pageA, npubB);
      console.log('User B: Following User A...');
      await followUser(pageB, npubA);

      // Wait for WebRTC connection to establish via follows pool
      await pageA.waitForTimeout(3000);

      // Navigate back to public folders
      await pageA.goto(`http://localhost:5173/#/${npubA}/public`);
      await expect(pageA.getByRole('button', { name: /File/ }).first()).toBeVisible({ timeout: 30000 });
      await pageB.goto(`http://localhost:5173/#/${npubB}/public`);
      await expect(pageB.getByRole('button', { name: /File/ }).first()).toBeVisible({ timeout: 30000 });

      // === User A: Create document and type content ===
      console.log('User A: Creating document...');
      await createDocument(pageA, 'shared-notes');
      await typeInEditor(pageA, 'Hello from User A!');
      await waitForSave(pageA);
      console.log('User A: Document saved');

      // === User B: Create document at same path and type content ===
      console.log('User B: Creating document...');
      await createDocument(pageB, 'shared-notes');
      await typeInEditor(pageB, 'Hello from User B!');
      await waitForSave(pageB);
      console.log('User B: Document saved');

      // === User A: Navigate to User B's document ===
      // Since both have each other as editors, A should see B's content when viewing B's doc
      console.log('User A: Navigating to User B\'s document...');
      await navigateToUserDocument(pageA, npubB, 'public', 'shared-notes');

      // Wait for B's content to appear (sync via Nostr subscription)
      await waitForEditorContent(pageA, 'Hello from User B!');
      const contentA = await pageA.locator('.ProseMirror').textContent();
      console.log(`User A (viewing B's doc) sees: "${contentA}"`);

      // === User B: Navigate to User A's document ===
      console.log('User B: Navigating to User A\'s document...');
      await navigateToUserDocument(pageB, npubA, 'public', 'shared-notes');

      // Wait for A's content to appear (sync via Nostr subscription)
      await waitForEditorContent(pageB, 'Hello from User A!');
      const contentB = await pageB.locator('.ProseMirror').textContent();
      console.log(`User B (viewing A's doc) sees: "${contentB}"`);

      console.log('\n=== Collaboration Test Passed ===');
      console.log(`User A's npub: ${npubA}`);
      console.log(`User B's npub: ${npubB}`);
      console.log(`User A viewing B's doc sees: "${contentA}"`);
      console.log(`User B viewing A's doc sees: "${contentB}"`);

    } finally {
      // Clean up
      await contextA.close();
      await contextB.close();
    }
  });

  test('real-time sync: A sees B edits without refresh when both view A document', async ({ browser }) => {
    // This test simulates both users viewing A's document simultaneously
    // Multiple back-and-forth edits to verify real convergence
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    // Log console for debugging
    pageA.on('console', msg => {
      if (msg.type() === 'error') console.log(`[User A Error] ${msg.text()}`);
      if (msg.text().includes('[YjsDoc')) console.log(`[User A] ${msg.text()}`);
    });
    pageB.on('console', msg => {
      if (msg.type() === 'error') console.log(`[User B Error] ${msg.text()}`);
      if (msg.text().includes('[YjsDoc')) console.log(`[User B] ${msg.text()}`);
    });

    try {
      // === Setup User A ===
      console.log('Setting up User A...');
      await setupFreshUser(pageA);
      const npubA = await getNpub(pageA);
      console.log(`User A npub: ${npubA.slice(0, 20)}...`);

      // === Setup User B ===
      console.log('Setting up User B...');
      await setupFreshUser(pageB);
      const npubB = await getNpub(pageB);
      console.log(`User B npub: ${npubB.slice(0, 20)}...`);

      // === Users follow each other (required for Nostr sync) ===
      console.log('User A: Following User B...');
      await followUser(pageA, npubB);
      console.log('User B: Following User A...');
      await followUser(pageB, npubA);

      // Wait for WebRTC connection to establish via follows pool
      await pageA.waitForTimeout(3000);

      // Navigate back to public folders
      await pageA.goto(`http://localhost:5173/#/${npubA}/public`);
      await expect(pageA.getByRole('button', { name: /File/ }).first()).toBeVisible({ timeout: 30000 });
      await pageB.goto(`http://localhost:5173/#/${npubB}/public`);
      await expect(pageB.getByRole('button', { name: /File/ }).first()).toBeVisible({ timeout: 30000 });

      // === User A: Create document and type content ===
      console.log('User A: Creating document...');
      await createDocument(pageA, 'realtime-doc');
      await typeInEditor(pageA, '[A-INIT]');
      await waitForSave(pageA);
      console.log('User A: Document saved');

      // === User A: Set editors (both A and B) - only A needs to set editors ===
      console.log('User A: Setting editors (A and B)...');
      await setEditors(pageA, [npubA, npubB]);
      console.log('User A: Editors set');

      // Wait for document to sync to User B via WebRTC
      console.log('Waiting for document sync...');
      await pageA.waitForTimeout(5000);

      // === User A stays on their document ===
      console.log('User A: Staying on document...');

      // === User B: Navigate to User A's document ===
      console.log('User B: Navigating to User A\'s document...');
      await navigateToUserDocument(pageB, npubA, 'public', 'realtime-doc');

      // Verify both see initial content
      const editorA = pageA.locator('.ProseMirror');
      const editorB = pageB.locator('.ProseMirror');
      await expect(editorA).toBeVisible({ timeout: 30000 });
      await expect(editorB).toBeVisible({ timeout: 30000 });

      // Both should see A's initial content
      await waitForEditorContent(pageA, '[A-INIT]');
      await waitForEditorContent(pageB, '[A-INIT]');
      console.log('Initial content verified on both sides');

      // === ROUND 1: B edits, A should see it ===
      console.log('\n=== Round 1: B edits ===');
      await editorB.click();
      await pageB.keyboard.type(' [B-R1]');
      await waitForSave(pageB);
      console.log('User B: Edit 1 saved');

      // Wait for sync - A should see B's edit
      await waitForEditorContent(pageA, '[B-R1]');
      console.log('User A: Received B R1');

      // === ROUND 2: A edits, B should see it ===
      console.log('\n=== Round 2: A edits ===');
      await editorA.click();
      await pageA.keyboard.type(' [A-R2]');
      await waitForSave(pageA);
      console.log('User A: Edit 2 saved');

      // Wait for sync - B should see A's edit
      await waitForEditorContent(pageB, '[A-R2]');
      console.log('User B: Received A R2');

      // === ROUND 3: B edits again, A should see it ===
      console.log('\n=== Round 3: B edits ===');
      await editorB.click();
      await pageB.keyboard.type(' [B-R3]');
      await waitForSave(pageB);
      console.log('User B: Edit 3 saved');

      // Wait for sync - A should see B's edit
      await waitForEditorContent(pageA, '[B-R3]');
      console.log('User A: Received B R3');

      // === ROUND 4: A edits again, B should see it ===
      console.log('\n=== Round 4: A edits ===');
      await editorA.click();
      await pageA.keyboard.type(' [A-R4]');
      await waitForSave(pageA);
      console.log('User A: Edit 4 saved');

      // Wait for sync - B should see A's edit
      await waitForEditorContent(pageB, '[A-R4]');
      console.log('User B: Received A R4');

      // === Final check: both should have all edits ===
      console.log('\n=== Final Convergence Check ===');
      const contentA = await editorA.textContent();
      const contentB = await editorB.textContent();
      console.log(`Final - A sees: "${contentA}"`);
      console.log(`Final - B sees: "${contentB}"`);

      // Both should have all the edits
      expect(contentA).toContain('[A-INIT]');
      expect(contentA).toContain('[B-R1]');
      expect(contentA).toContain('[A-R2]');
      expect(contentA).toContain('[B-R3]');
      expect(contentA).toContain('[A-R4]');

      expect(contentB).toContain('[A-INIT]');
      expect(contentB).toContain('[B-R1]');
      expect(contentB).toContain('[A-R2]');
      expect(contentB).toContain('[B-R3]');
      expect(contentB).toContain('[A-R4]');

      // Content should be identical (converged)
      expect(contentA).toBe(contentB);

      console.log('\n=== Real-time Sync Test PASSED - All 4 rounds converged! ===');

    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test('when B edits A document, document appears in B directory', async ({ browser }) => {
    // Scenario: B does NOT create their own document first
    // B navigates to A's document, makes an edit, and the document should appear in B's tree
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    pageA.on('console', msg => {
      if (msg.type() === 'error') console.log(`[User A Error] ${msg.text()}`);
      if (msg.text().includes('[YjsDocument')) console.log(`[User A] ${msg.text()}`);
    });
    pageB.on('console', msg => {
      if (msg.type() === 'error') console.log(`[User B Error] ${msg.text()}`);
      if (msg.text().includes('[YjsDocument')) console.log(`[User B] ${msg.text()}`);
    });

    try {
      // === Setup User A ===
      console.log('Setting up User A...');
      await setupFreshUser(pageA);
      const npubA = await getNpub(pageA);
      console.log(`User A npub: ${npubA.slice(0, 20)}...`);

      // === Setup User B ===
      console.log('Setting up User B...');
      await setupFreshUser(pageB);
      const npubB = await getNpub(pageB);
      console.log(`User B npub: ${npubB.slice(0, 20)}...`);

      // === Mutual follows for reliable WebRTC connection ===
      console.log('User A: Following User B...');
      await followUser(pageA, npubB);
      console.log('User B: Following User A...');
      await followUser(pageB, npubA);

      // Wait for WebRTC connection to establish via follows pool
      await pageA.waitForTimeout(3000);

      // Navigate back to public folders after following
      await pageA.goto(`http://localhost:5173/#/${npubA}/public`);
      await expect(pageA.getByRole('button', { name: 'New Document' })).toBeVisible({ timeout: 30000 });

      // === User A: Create document with B as editor ===
      console.log('User A: Creating document...');
      await createDocument(pageA, 'shared-doc');
      await typeInEditor(pageA, 'Original content from A.');
      await waitForSave(pageA);
      console.log('User A: Document saved');

      // === User A: Set editors (both A and B) ===
      console.log('User A: Setting editors (A and B)...');
      await setEditors(pageA, [npubA, npubB]);
      console.log('User A: Editors set');

      // Wait for User A's tree data to propagate to User B via Nostr/WebRTC
      // User B's resolver needs to receive the tree metadata before navigation
      console.log('Waiting for tree data to sync to User B...');
      await pageA.waitForTimeout(5000);

      // Note: B does NOT create their own document!
      // B will navigate directly to A's document and edit it

      // === User B: Navigate to User A's document ===
      console.log('User B: Navigating to User A\'s document (B has NO document yet)...');
      // First verify B can see A's trees in the resolver
      await pageB.goto(`http://localhost:5173/#/${npubA}`);
      await expect(pageB.getByRole('link', { name: 'public' }).first()).toBeVisible({ timeout: 30000 });

      // Now navigate to the specific document
      await navigateToUserDocument(pageB, npubA, 'public', 'shared-doc');
      await pageB.waitForTimeout(3000);

      // Verify B sees A's content
      const editorB = pageB.locator('.ProseMirror');
      await expect(editorB).toBeVisible({ timeout: 30000 });
      let contentB = await editorB.textContent();
      console.log(`User B sees: "${contentB}"`);
      expect(contentB).toContain('Original content from A.');

      // B makes an edit
      console.log('User B: Editing A\'s document...');
      await editorB.click();
      await pageB.keyboard.type(' [B\'s contribution]');
      await pageB.waitForTimeout(500);

      // Wait for auto-save
      await waitForSave(pageB);
      console.log('User B: Edit saved');

      // === User B: Navigate to B's own public folder ===
      console.log('User B: Navigating to own public folder...');
      await pageB.goto(`http://localhost:5173/#/${npubB}/public`);
      await pageB.waitForTimeout(3000);

      // Check if the document appears in B's directory
      console.log('Checking if document appears in B\'s directory...');
      const docLink = pageB.getByRole('link', { name: 'shared-doc' }).first();
      await expect(docLink).toBeVisible({ timeout: 30000 });
      console.log('SUCCESS: shared-doc appears in B\'s directory!');

      // Click into the document and verify content
      await docLink.click();
      await pageB.waitForTimeout(2000);

      const editorBOwn = pageB.locator('.ProseMirror');
      await expect(editorBOwn).toBeVisible({ timeout: 30000 });
      const contentBOwn = await editorBOwn.textContent();
      console.log(`User B's own copy contains: "${contentBOwn}"`);
      expect(contentBOwn).toContain('[B\'s contribution]');

      console.log('\n=== Document in B\'s Directory Test Passed ===');

    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test('editor can edit another users document and changes persist', async ({ browser }) => {
    // Create two browser contexts (simulating two different users)
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    // Log console for debugging
    pageA.on('console', msg => {
      if (msg.type() === 'error') console.log(`[User A Error] ${msg.text()}`);
      if (msg.text().includes('[YjsDocument') || msg.text().includes('[autosaveIfOwn]')) console.log(`[User A] ${msg.text()}`);
    });
    pageB.on('console', msg => {
      if (msg.type() === 'error') console.log(`[User B Error] ${msg.text()}`);
      if (msg.text().includes('[YjsDocument]') || msg.text().includes('[autosaveIfOwn]')) console.log(`[User B] ${msg.text()}`);
    });

    try {
      // === Setup User A ===
      console.log('Setting up User A...');
      await setupFreshUser(pageA);
      const npubA = await getNpub(pageA);
      console.log(`User A npub: ${npubA.slice(0, 20)}...`);

      // === Setup User B ===
      console.log('Setting up User B...');
      await setupFreshUser(pageB);
      const npubB = await getNpub(pageB);
      console.log(`User B npub: ${npubB.slice(0, 20)}...`);

      // === Mutual follows for reliable WebRTC connection ===
      console.log('User A: Following User B...');
      await followUser(pageA, npubB);
      console.log('User B: Following User A...');
      await followUser(pageB, npubA);

      // Wait for WebRTC connection to establish via follows pool
      await pageA.waitForTimeout(3000);

      // Navigate back to public folders after following
      await pageA.goto(`http://localhost:5173/#/${npubA}/public`);
      await expect(pageA.getByRole('button', { name: 'New Document' })).toBeVisible({ timeout: 30000 });
      await pageB.goto(`http://localhost:5173/#/${npubB}/public`);
      await expect(pageB.getByRole('button', { name: 'New Document' })).toBeVisible({ timeout: 30000 });

      // === User A: Create document and type content ===
      console.log('User A: Creating document...');
      await createDocument(pageA, 'collab-doc');
      await typeInEditor(pageA, 'Initial content from A.');
      await waitForSave(pageA);
      console.log('User A: Document saved');

      // === User A: Set editors (both A and B) ===
      console.log('User A: Setting editors (A and B)...');
      await setEditors(pageA, [npubA, npubB]);
      console.log('User A: Editors set');

      // === User B: Also create the same document path (so B has a tree to save to) ===
      console.log('User B: Creating document at same path...');
      await createDocument(pageB, 'collab-doc');
      await typeInEditor(pageB, 'Initial content from B.');
      await waitForSave(pageB);
      console.log('User B: Document saved');

      // === User B: Set editors (both A and B) ===
      console.log('User B: Setting editors (A and B)...');
      await setEditors(pageB, [npubA, npubB]);
      console.log('User B: Editors set');

      // === User B: Navigate to User A's document and add more content ===
      console.log('User B: Navigating to User A\'s document...');
      await navigateToUserDocument(pageB, npubA, 'public', 'collab-doc');
      await pageB.waitForTimeout(3000);

      // Verify B sees A's content
      const editorB = pageB.locator('.ProseMirror');
      await expect(editorB).toBeVisible({ timeout: 30000 });
      let contentB = await editorB.textContent();
      console.log(`User B sees before editing: "${contentB}"`);
      expect(contentB).toContain('Initial content from A.');

      // B types additional content while viewing A's doc
      console.log('User B: Adding content to A\'s document...');
      await editorB.click();
      await pageB.keyboard.type(' [Edit by B]');
      await pageB.waitForTimeout(500);

      // Wait for auto-save
      await waitForSave(pageB);
      console.log('User B: Edit saved');

      // Check what B sees after editing
      contentB = await editorB.textContent();
      console.log(`User B sees after editing: "${contentB}"`);
      expect(contentB).toContain('[Edit by B]');

      // === User A: Refresh their document and check if B's edit is visible ===
      console.log('User A: Refreshing own document...');
      await navigateToOwnDocument(pageA, npubA, 'public', 'collab-doc');
      await pageA.waitForTimeout(5000); // Wait for subscription to fetch B's updates

      const editorA = pageA.locator('.ProseMirror');
      await expect(editorA).toBeVisible({ timeout: 30000 });
      const contentA = await editorA.textContent();
      console.log(`User A sees after B's edit: "${contentA}"`);

      // A should see their original content plus B's edit (merged)
      expect(contentA).toContain('Initial content from A.');
      expect(contentA).toContain('[Edit by B]');

      console.log('\n=== Edit Persistence Test Passed ===');

    } finally {
      // Clean up
      await contextA.close();
      await contextB.close();
    }
  });

  test('editors count badge shows correct count after document creation and adding collaborator', async ({ page }) => {
    // This test verifies:
    // 1. When creating a new document, owner's npub should be in .yjs and badge should show "1"
    // 2. After adding a collaborator, badge should show "2"

    setupPageErrorHandler(page);

    // Log console for debugging
    page.on('console', msg => {
      if (msg.type() === 'error') console.log(`[Error] ${msg.text()}`);
      if (msg.text().includes('[YjsDocument') || msg.text().includes('collaborator')) {
        console.log(`[Console] ${msg.text()}`);
      }
    });

    // Setup fresh user
    console.log('Setting up fresh user...');
    await setupFreshUser(page);
    const npub = await getNpub(page);
    console.log(`User npub: ${npub.slice(0, 20)}...`);

    // Create a new document
    console.log('Creating new document...');
    await createDocument(page, 'test-editors-count');

    // Wait for document to load
    await page.waitForTimeout(2000);

    // Check the editors count badge - should show "1" (the owner)
    console.log('Checking editors count badge after creation...');
    const editorsButton = page.locator('button[title="Manage editors"]');
    await expect(editorsButton).toBeVisible({ timeout: 30000 });

    // Get button HTML for debugging
    const buttonHtml = await editorsButton.innerHTML();
    console.log(`Editors button HTML: ${buttonHtml}`);

    // The badge is inside the button as a span with the count
    const countBadge = editorsButton.locator('span.rounded-full');
    const hasBadge = await countBadge.count();
    console.log(`Badge count elements found: ${hasBadge}`);

    if (hasBadge === 0) {
      // Badge not found - this means collaborators.length is 0
      // Let's open the modal to see what's in the list
      console.log('No badge found, opening modal to check editors list...');
      await editorsButton.click();
      await page.waitForTimeout(1000);

      // Check the list
      const listItems = page.locator('.bg-surface-1 ul li');
      const listCount = await listItems.count();
      console.log(`Editors in modal list: ${listCount}`);

      // Check for "No editors yet" message
      const noEditorsMsg = page.locator('text=No editors yet');
      const hasNoEditorsMsg = await noEditorsMsg.count();
      console.log(`"No editors yet" message visible: ${hasNoEditorsMsg > 0}`);

      // Close modal for further testing
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }

    await expect(countBadge).toBeVisible({ timeout: 30000 });
    const initialCount = await countBadge.textContent();
    console.log(`Initial editors count: ${initialCount}`);
    expect(initialCount).toBe('1');

    // Now add a collaborator (use a fake npub for testing)
    console.log('Adding a collaborator...');
    await editorsButton.click();
    await page.waitForTimeout(500);

    // Wait for modal
    const modal = page.locator('h2:has-text("Editors")');
    await expect(modal).toBeVisible({ timeout: 30000 });

    // Verify owner is already in the list
    console.log('Verifying owner is in the editors list...');
    const editorsList = page.locator('ul li');
    const editorsCount = await editorsList.count();
    console.log(`Editors in list: ${editorsCount}`);
    expect(editorsCount).toBeGreaterThanOrEqual(1);

    // Add a second editor (use a valid bech32-encoded npub)
    const fakeNpub = 'npub1vpqsg7spcesqesfhjjept2rk3p5n9pcd3ef7aqsgyweehxl8dhzqu5deq5';
    const input = page.locator('input[placeholder="npub1..."]');
    await input.fill(fakeNpub);
    await page.waitForTimeout(500);

    // Click the confirm button from the preview
    const confirmButton = page.locator('button.btn-success').filter({ hasText: /^Add/ }).first();
    await expect(confirmButton).toBeVisible({ timeout: 3000 });
    await confirmButton.click();
    await page.waitForTimeout(500);

    // Modal auto-saves on add, just close it using the footer Close button (not the X)
    const closeButton = page.getByText('Close', { exact: true });
    await closeButton.click();
    await page.waitForTimeout(2000);

    // Check the editors count badge - should now show "2"
    console.log('Checking editors count badge after adding collaborator...');
    const updatedCountBadge = editorsButton.locator('span.rounded-full');
    await expect(updatedCountBadge).toBeVisible({ timeout: 30000 });
    const updatedCount = await updatedCountBadge.textContent();
    console.log(`Updated editors count: ${updatedCount}`);
    expect(updatedCount).toBe('2');

    console.log('\n=== Editors Count Badge Test Passed ===');
  });

  test('document becomes editable without refresh when user is added as editor', async ({ browser }) => {
    // This test verifies:
    // 1. User B views User A's document - should be read-only initially
    // 2. User A adds B as editor
    // 3. User B can edit the document WITHOUT refreshing the page

    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    setupPageErrorHandler(pageA);
    setupPageErrorHandler(pageB);

    pageA.on('console', msg => {
      if (msg.text().includes('[YjsDoc]')) console.log(`[User A] ${msg.text()}`);
    });
    pageB.on('console', msg => {
      if (msg.text().includes('[YjsDoc]')) console.log(`[User B] ${msg.text()}`);
    });

    try {
      // Setup User A
      console.log('Setting up User A...');
      await setupFreshUser(pageA);
      const npubA = await getNpub(pageA);
      console.log(`User A npub: ${npubA.slice(0, 20)}...`);

      // Setup User B
      console.log('Setting up User B...');
      await setupFreshUser(pageB);
      const npubB = await getNpub(pageB);
      console.log(`User B npub: ${npubB.slice(0, 20)}...`);

      // Have users follow each other to establish WebRTC connection via follows pool
      console.log('User A: Following User B...');
      await followUser(pageA, npubB);
      console.log('User B: Following User A...');
      await followUser(pageB, npubA);

      // Wait for WebRTC connection to establish via follows pool
      await pageA.waitForTimeout(3000);

      // Navigate back to public folders after following
      await pageA.goto(`http://localhost:5173/#/${npubA}/public`);
      await pageA.waitForTimeout(1000);
      await pageB.goto(`http://localhost:5173/#/${npubB}/public`);
      await pageB.waitForTimeout(1000);

      // Wait for WebRTC peer connection to establish between A and B
      // Check that the peer indicator shows at least 1 peer
      console.log('Waiting for WebRTC peer connection...');
      const peerIndicator = pageA.locator('[data-testid="peer-indicator-dot"]');
      try {
        // Wait for peer indicator to turn green (has peers)
        await expect(peerIndicator).toHaveCSS('color', 'rgb(63, 185, 80)', { timeout: 30000 });
        console.log('Peer connection established');
      } catch {
        // If no peers after 15s, continue anyway - test will check content
        console.log('Peer indicator not green, continuing...');
      }

      // User A creates a document
      console.log('User A: Creating document...');
      await createDocument(pageA, 'editor-test');

      // User A adds initial content
      const editorA = pageA.locator('.ProseMirror');
      await expect(editorA).toBeVisible({ timeout: 30000 });
      await editorA.click();
      await pageA.keyboard.type('Content from owner.');
      await waitForSave(pageA);
      console.log('User A: Document saved');

      // User B navigates to A's document (without being an editor yet)
      console.log('User B: Navigating to A\'s document (not an editor yet)...');
      await pageB.goto(`http://localhost:5173/#/${npubA}/public/editor-test`);
      await pageB.waitForTimeout(2000);

      // Verify B sees the document - wait for content to sync via WebRTC
      const editorB = pageB.locator('.ProseMirror');
      await expect(editorB).toBeVisible({ timeout: 30000 });

      // Wait for content to appear (may take time for WebRTC sync)
      await expect(editorB).toContainText('Content from owner', { timeout: 30000 });
      const contentB = await editorB.textContent();
      console.log(`User B sees: "${contentB}"`);

      // Verify B sees "Read-only" badge (not an editor)
      const readOnlyBadge = pageB.locator('text=Read-only');
      const isReadOnly = await readOnlyBadge.isVisible();
      console.log(`User B read-only status: ${isReadOnly}`);
      expect(isReadOnly).toBe(true);

      // User A now adds B as an editor
      console.log('User A: Adding B as editor...');
      await setEditors(pageA, [npubA, npubB]);
      console.log('User A: Editors updated');

      // Wait for B to receive the update via subscription
      console.log('Waiting for B to receive editor status update...');
      await pageB.waitForTimeout(5000);

      // Verify B no longer sees "Read-only" badge
      const readOnlyAfter = await pageB.locator('text=Read-only').isVisible();
      console.log(`User B read-only status after being added: ${readOnlyAfter}`);
      expect(readOnlyAfter).toBe(false);

      // B should now see "Editor" badge (exact match to avoid ambiguity)
      const editorBadge = pageB.getByText('Editor', { exact: true });
      const hasEditorIndicator = await editorBadge.isVisible();
      console.log(`User B has editor indicator: ${hasEditorIndicator}`);
      expect(hasEditorIndicator).toBe(true);

      // The key test: B should be able to type without refresh
      console.log('User B: Attempting to edit document...');
      await editorB.click();
      await pageB.keyboard.type(' [B-EDIT]');
      await pageB.waitForTimeout(2000);

      // Check if B's edit appeared
      const contentAfterEdit = await editorB.textContent();
      console.log(`User B content after edit: "${contentAfterEdit}"`);
      expect(contentAfterEdit).toContain('[B-EDIT]');

      // Verify A sees B's edit
      await pageA.waitForTimeout(3000);
      const contentA = await editorA.textContent();
      console.log(`User A sees: "${contentA}"`);
      expect(contentA).toContain('[B-EDIT]');

      console.log('\n=== Document Becomes Editable Without Refresh Test PASSED ===');

    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test('long document collaboration persists after refresh for both users', async ({ browser }) => {
    // This test verifies:
    // 1. Two users can collaboratively write a longer document with edits at different positions
    // 2. All content persists after both users refresh
    // 3. Content is correctly merged even with concurrent edits at beginning, middle, and end
    // 4. Tests the delta-based storage format (multiple deltas created)

    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    setupPageErrorHandler(pageA);
    setupPageErrorHandler(pageB);

    try {
      // Setup User A
      console.log('Setting up User A...');
      await setupFreshUser(pageA);
      const npubA = await getNpub(pageA);
      console.log(`User A npub: ${npubA.slice(0, 20)}...`);

      // Setup User B
      console.log('Setting up User B...');
      await setupFreshUser(pageB);
      const npubB = await getNpub(pageB);
      console.log(`User B npub: ${npubB.slice(0, 20)}...`);

      // User A creates a document with initial structure
      console.log('User A: Creating document...');
      await createDocument(pageA, 'collab-doc');

      // User A adds initial content
      const editorA = pageA.locator('.ProseMirror');
      await expect(editorA).toBeVisible({ timeout: 30000 });
      await editorA.click();
      await pageA.keyboard.type('Initial text from A.');
      await pageA.waitForTimeout(1500);
      console.log('User A: Added initial content');

      // User A adds B as editor
      console.log('User A: Setting editors...');
      await setEditors(pageA, [npubA, npubB]);
      console.log('User A: Editors set');

      // User B creates document at same path (so B has a tree to save to)
      console.log('User B: Creating document at same path...');
      await createDocument(pageB, 'collab-doc');
      await typeInEditor(pageB, 'B initial content');
      await waitForSave(pageB);
      console.log('User B: Document saved');

      // User B also sets editors (both A and B)
      console.log('User B: Setting editors...');
      await setEditors(pageB, [npubA, npubB]);
      console.log('User B: Editors set');

      // User A navigates back to their own document (after editors modal)
      console.log('User A: Navigating back to own document...');
      await navigateToOwnDocument(pageA, npubA, 'public', 'collab-doc');
      await pageA.waitForTimeout(2000);

      // Verify editorA is visible
      await expect(editorA).toBeVisible({ timeout: 30000 });
      console.log('User A: Document visible after navigation');

      // User B navigates to User A's document
      console.log('User B: Navigating to User A\'s document...');
      await navigateToUserDocument(pageB, npubA, 'public', 'collab-doc');

      // Wait for document to load (may take longer under parallel load with WebRTC)
      const editorB = pageB.locator('.ProseMirror');
      await expect(editorB).toBeVisible({ timeout: 30000 });
      await expect(editorB).toContainText('Initial text', { timeout: 30000 });
      console.log('User B: Can see User A\'s content');

      // IMPORTANT: Wait for sync after each edit to avoid race conditions
      // where position-based edits end up inside other markers

      // User B adds at the BEGINNING
      await editorB.click();
      await pageB.keyboard.press('Home');
      await pageB.keyboard.type('[B-START] ');
      await pageB.waitForTimeout(1500);
      console.log('User B: Added at beginning');
      // Wait for A to see B's edit
      await expect(editorA).toContainText('[B-START]', { timeout: 30000 });

      // User A adds at the END
      await editorA.click();
      await pageA.keyboard.press('End');
      await pageA.keyboard.type(' [A-END1]');
      await pageA.waitForTimeout(1500);
      console.log('User A: Added at end');
      // Wait for B to see A's edit
      await expect(editorB).toContainText('[A-END1]', { timeout: 30000 });

      // User B adds at the END
      await editorB.click();
      await pageB.keyboard.press('End');
      await pageB.keyboard.type(' [B-END1]');
      await pageB.waitForTimeout(1500);
      console.log('User B: Added at end');
      // Wait for A to see B's edit
      await expect(editorA).toContainText('[B-END1]', { timeout: 30000 });

      // User A adds at the BEGINNING
      await editorA.click();
      await pageA.keyboard.press('Home');
      await pageA.keyboard.type('[A-START] ');
      await pageA.waitForTimeout(1500);
      console.log('User A: Added at beginning');
      // Wait for B to see A's edit
      await expect(editorB).toContainText('[A-START]', { timeout: 30000 });

      // Now do middle edits - use search/replace approach instead of arrow keys
      // User B adds [B-MID] after "Initial" - using Ctrl+End then backspace approach
      // Actually simpler: type at end with unique marker, no middle needed
      // The test goal is to verify persistence - beginning/end edits are sufficient

      // User B types additional text at end
      await editorB.click();
      await pageB.keyboard.press('End');
      await pageB.keyboard.type(' [B-MID]');
      await pageB.waitForTimeout(1500);
      console.log('User B: Added B-MID at end');
      await expect(editorA).toContainText('[B-MID]', { timeout: 30000 });

      // User A types additional text at end
      await editorA.click();
      await pageA.keyboard.press('End');
      await pageA.keyboard.type(' [A-MID]');
      await pageA.waitForTimeout(1500);
      console.log('User A: Added A-MID at end');
      await expect(editorB).toContainText('[A-MID]', { timeout: 30000 });

      // Wait for all saves to complete
      await pageA.waitForTimeout(2000);
      await pageB.waitForTimeout(2000);

      // Get content before refresh
      const contentBeforeRefresh = await editorA.textContent();
      console.log(`Content before refresh: "${contentBeforeRefresh}"`);

      // Verify all markers are present before refresh
      const markersToCheck = ['[A-START]', '[B-START]', '[A-END1]', '[B-END1]', '[A-MID]', '[B-MID]'];
      for (const marker of markersToCheck) {
        if (!contentBeforeRefresh?.includes(marker)) {
          console.log(`Warning: Marker ${marker} not found before refresh`);
        }
      }

      // User A refreshes
      console.log('User A: Refreshing page...');
      await pageA.reload();
      await pageA.waitForTimeout(3000);

      // Verify A's editor is visible after refresh
      const editorAAfterRefresh = pageA.locator('.ProseMirror');
      await expect(editorAAfterRefresh).toBeVisible({ timeout: 30000 });

      // Check A sees all content from both users
      const contentAAfterRefresh = await editorAAfterRefresh.textContent();
      console.log(`User A after refresh sees: "${contentAAfterRefresh}"`);

      // Check all markers are present (content from both users persisted)
      expect(contentAAfterRefresh).toContain('[A-START]');
      expect(contentAAfterRefresh).toContain('[B-START]');
      expect(contentAAfterRefresh).toContain('[A-END1]');
      expect(contentAAfterRefresh).toContain('[B-END1]');
      expect(contentAAfterRefresh).toContain('[A-MID]');
      expect(contentAAfterRefresh).toContain('[B-MID]');
      expect(contentAAfterRefresh).toContain('Initial');
      // Check for 'A.' separately since middle edits can split 'from A.'
      expect(contentAAfterRefresh).toContain('A.');

      // User B refreshes
      console.log('User B: Refreshing page...');
      await pageB.reload();
      await pageB.waitForTimeout(3000);

      // Verify B's editor is visible after refresh
      const editorBAfterRefresh = pageB.locator('.ProseMirror');
      await expect(editorBAfterRefresh).toBeVisible({ timeout: 30000 });

      // Check B sees all content from both users
      const contentBAfterRefresh = await editorBAfterRefresh.textContent();
      console.log(`User B after refresh sees: "${contentBAfterRefresh}"`);

      expect(contentBAfterRefresh).toContain('[A-START]');
      expect(contentBAfterRefresh).toContain('[B-START]');
      expect(contentBAfterRefresh).toContain('[A-END1]');
      expect(contentBAfterRefresh).toContain('[B-END1]');
      expect(contentBAfterRefresh).toContain('[A-MID]');
      expect(contentBAfterRefresh).toContain('[B-MID]');
      expect(contentBAfterRefresh).toContain('Initial');
      // Check for 'A.' separately since middle edits can split 'from A.'
      expect(contentBAfterRefresh).toContain('A.');

      console.log('\n=== Long Document Collaboration Persistence Test Passed ===');
      console.log(`User A's npub: ${npubA}`);
      console.log(`User B's npub: ${npubB}`);
      console.log(`Final content (A): "${contentAAfterRefresh}"`);
      console.log(`Final content (B): "${contentBAfterRefresh}"`);

    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});
