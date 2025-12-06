/**
 * E2E tests for Yjs collaborative document editing
 *
 * Tests that two users (A and B) can:
 * 1. Create documents at the same path
 * 2. Add both npubs to their .yjs config files (all editors including self)
 * 3. See each other's edits automatically via subscription
 */
import { test, expect, Page } from '@playwright/test';
import { setupPageErrorHandler } from './test-utils.js';

// Helper to set up a fresh user session
async function setupFreshUser(page: Page) {
  setupPageErrorHandler(page);

  await page.goto('http://localhost:5173');

  // Clear storage for fresh state
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
  await page.waitForSelector('header span:has-text("hashtree")', { timeout: 10000 });

  // Wait for the public folder link to appear
  const publicLink = page.getByRole('link', { name: 'public' }).first();
  await expect(publicLink).toBeVisible({ timeout: 15000 });

  // Click into the public folder
  await publicLink.click();
  await page.waitForURL(/\/#\/npub.*\/public/, { timeout: 10000 });
  await expect(page.getByRole('button', { name: /File/ }).first()).toBeVisible({ timeout: 10000 });
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
  await page.getByRole('button', { name: 'New Document' }).click();
  await page.waitForTimeout(500);
  await page.locator('input[placeholder="Document name..."]').fill(name);
  await page.getByRole('button', { name: 'Create' }).click();
  await page.waitForTimeout(2000);

  // Verify document is created (auto-navigated into it) - look for the document name in the toolbar
  const docToolbar = page.locator(`text=${name}`).first();
  await expect(docToolbar).toBeVisible({ timeout: 10000 });
}

// Helper to type content in the editor
async function typeInEditor(page: Page, content: string) {
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible({ timeout: 5000 });
  await editor.click();
  await page.keyboard.type(content);
  await page.waitForTimeout(500);
}

// Helper to wait for auto-save
async function waitForSave(page: Page) {
  await page.waitForTimeout(2000);
  const savedStatus = page.locator('text=Saved');
  await expect(savedStatus).toBeVisible({ timeout: 10000 });
}

// Helper to set editors using the Collaborators modal UI
// Note: This assumes we're viewing the YjsDocument (inside the document folder)
async function setEditors(page: Page, npubs: string[]) {
  // Click the collaborators button (users icon) in the toolbar
  const collabButton = page.locator('button[title="Manage collaborators"]');
  await expect(collabButton).toBeVisible({ timeout: 5000 });
  await collabButton.click();
  await page.waitForTimeout(500);

  // Wait for the modal to appear
  const modal = page.locator('h2:has-text("Collaborators")');
  await expect(modal).toBeVisible({ timeout: 5000 });

  // Add each npub
  for (const npub of npubs) {
    const input = page.locator('input[placeholder="npub1..."]');
    await input.fill(npub);

    const addButton = page.getByRole('button', { name: 'Add' });
    await addButton.click();
    await page.waitForTimeout(300);
  }

  // Save
  const saveButton = page.getByRole('button', { name: 'Save' });
  await saveButton.click();
  await page.waitForTimeout(2000);
}

// Helper to navigate to another user's document
async function navigateToUserDocument(page: Page, npub: string, treeName: string, docPath: string) {
  const url = `http://localhost:5173/#/${npub}/${treeName}/${docPath}`;
  await page.goto(url);
  await page.waitForTimeout(2000);
}

// Helper to navigate to own document
async function navigateToOwnDocument(page: Page, npub: string, treeName: string, docPath: string) {
  const url = `http://localhost:5173/#/${npub}/${treeName}/${docPath}`;
  await page.goto(url);
  await page.waitForTimeout(2000);
}

test.describe('Yjs Collaborative Document Editing', () => {
  test.setTimeout(180000); // 3 minutes for collaboration test

  test('two users can see each others edits when viewing each others documents', async ({ browser }) => {
    // Create two browser contexts (simulating two different users)
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    // Log console for debugging
    pageA.on('console', msg => {
      if (msg.type() === 'error') console.log(`[User A Error] ${msg.text()}`);
    });
    pageB.on('console', msg => {
      if (msg.type() === 'error') console.log(`[User B Error] ${msg.text()}`);
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

      // === User A: Create document and type content ===
      console.log('User A: Creating document...');
      await createDocument(pageA, 'shared-notes');
      await typeInEditor(pageA, 'Hello from User A!');
      await waitForSave(pageA);
      console.log('User A: Document saved');

      // === User A: Set editors (both A and B) ===
      console.log('User A: Setting editors (A and B)...');
      await setEditors(pageA, [npubA, npubB]);
      console.log('User A: Editors set');

      // === User B: Create document at same path and type content ===
      console.log('User B: Creating document...');
      await createDocument(pageB, 'shared-notes');
      await typeInEditor(pageB, 'Hello from User B!');
      await waitForSave(pageB);
      console.log('User B: Document saved');

      // === User B: Set editors (both A and B) ===
      console.log('User B: Setting editors (A and B)...');
      await setEditors(pageB, [npubA, npubB]);
      console.log('User B: Editors set');

      // === User A: Navigate to User B's document ===
      // Since both have each other as editors, A should see B's content when viewing B's doc
      console.log('User A: Navigating to User B\'s document...');
      await navigateToUserDocument(pageA, npubB, 'public', 'shared-notes');

      // Wait for document to load
      await pageA.waitForTimeout(3000);

      // Check if A sees B's content when viewing B's doc
      const editorA = pageA.locator('.ProseMirror');
      await expect(editorA).toBeVisible({ timeout: 5000 });
      const contentA = await editorA.textContent();
      console.log(`User A (viewing B's doc) sees: "${contentA}"`);

      // When viewing B's document, A should see B's content
      // Since A is in B's editor list, A should also see their own content merged
      expect(contentA).toContain('Hello from User B!');

      // === User B: Navigate to User A's document ===
      console.log('User B: Navigating to User A\'s document...');
      await navigateToUserDocument(pageB, npubA, 'public', 'shared-notes');

      // Wait for document to load
      await pageB.waitForTimeout(3000);

      // Check if B sees A's content when viewing A's doc
      const editorB = pageB.locator('.ProseMirror');
      await expect(editorB).toBeVisible({ timeout: 5000 });
      const contentB = await editorB.textContent();
      console.log(`User B (viewing A's doc) sees: "${contentB}"`);

      // When viewing A's document, B should see A's content
      // Since B is in A's editor list, B should also see their own content merged
      expect(contentB).toContain('Hello from User A!');

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
    // When B edits while viewing A's doc, A should see the changes in real-time
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    // Log console for debugging
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

      // === User A: Create document and type content ===
      console.log('User A: Creating document...');
      await createDocument(pageA, 'realtime-doc');
      await typeInEditor(pageA, 'Content from A.');
      await waitForSave(pageA);
      console.log('User A: Document saved');

      // === User A: Set editors (both A and B) ===
      console.log('User A: Setting editors (A and B)...');
      await setEditors(pageA, [npubA, npubB]);
      console.log('User A: Editors set');

      // === User B: Create document at same path (so B has a tree to save to) ===
      console.log('User B: Creating document at same path...');
      await createDocument(pageB, 'realtime-doc');
      await typeInEditor(pageB, 'Content from B.');
      await waitForSave(pageB);
      console.log('User B: Document saved');

      // === User B: Set editors (both A and B) ===
      console.log('User B: Setting editors (A and B)...');
      await setEditors(pageB, [npubA, npubB]);
      console.log('User B: Editors set');

      // === User A stays on their document ===
      // A is already viewing their own document from setup
      console.log('User A: Navigating back to own document...');
      await navigateToOwnDocument(pageA, npubA, 'public', 'realtime-doc');
      await pageA.waitForTimeout(3000);

      // === User B: Navigate to User A's document ===
      console.log('User B: Navigating to User A\'s document...');
      await navigateToUserDocument(pageB, npubA, 'public', 'realtime-doc');
      await pageB.waitForTimeout(3000);

      // Verify both see initial content
      const editorA = pageA.locator('.ProseMirror');
      const editorB = pageB.locator('.ProseMirror');
      await expect(editorA).toBeVisible({ timeout: 5000 });
      await expect(editorB).toBeVisible({ timeout: 5000 });

      let contentA = await editorA.textContent();
      let contentB = await editorB.textContent();
      console.log(`Initial - User A sees: "${contentA}"`);
      console.log(`Initial - User B sees: "${contentB}"`);

      // B should see A's content (plus potentially B's merged content)
      expect(contentB).toContain('Content from A.');

      // === B makes an edit while A is watching ===
      console.log('User B: Making edit while A watches...');
      await editorB.click();
      await pageB.keyboard.type(' [REALTIME EDIT]');
      await pageB.waitForTimeout(500);

      // Wait for B's save
      await waitForSave(pageB);
      console.log('User B: Edit saved to B\'s tree');

      // === Wait for A to receive the update via subscription ===
      console.log('Waiting for A to receive B\'s update via subscription...');
      await pageA.waitForTimeout(5000); // Give time for nostr to propagate and subscription to fire

      // Check what A sees now (without refreshing!)
      contentA = await editorA.textContent();
      console.log(`After B's edit - User A sees: "${contentA}"`);

      // A should see B's edit in real-time
      expect(contentA).toContain('[REALTIME EDIT]');

      console.log('\n=== Real-time Sync Test Passed ===');

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

      // Note: B does NOT create their own document!
      // B will navigate directly to A's document and edit it

      // === User B: Navigate to User A's document ===
      console.log('User B: Navigating to User A\'s document (B has NO document yet)...');
      await navigateToUserDocument(pageB, npubA, 'public', 'shared-doc');
      await pageB.waitForTimeout(3000);

      // Verify B sees A's content
      const editorB = pageB.locator('.ProseMirror');
      await expect(editorB).toBeVisible({ timeout: 5000 });
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
      await expect(docLink).toBeVisible({ timeout: 10000 });
      console.log('SUCCESS: shared-doc appears in B\'s directory!');

      // Click into the document and verify content
      await docLink.click();
      await pageB.waitForTimeout(2000);

      const editorBOwn = pageB.locator('.ProseMirror');
      await expect(editorBOwn).toBeVisible({ timeout: 5000 });
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
      await expect(editorB).toBeVisible({ timeout: 5000 });
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
      await expect(editorA).toBeVisible({ timeout: 5000 });
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
});
