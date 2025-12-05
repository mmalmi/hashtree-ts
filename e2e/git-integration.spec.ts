import { test, expect } from '@playwright/test';
import { setupPageErrorHandler, waitForNewUserRedirect, myTreesButtonSelector } from './test-utils.js';

test.describe('Git integration features', () => {
  test('dotfiles like .git and .claude should be treated as directories', async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await waitForNewUserRedirect(page);

    // Navigate to tree list and create a folder
    await page.locator(myTreesButtonSelector).click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'New Folder' }).click();

    const input = page.locator('input[placeholder="Folder name..."]');
    await input.waitFor({ timeout: 5000 });
    await input.fill('dotfile-test');
    await page.click('button:has-text("Create")');

    // Wait for modal to close
    await expect(page.locator('.fixed.inset-0.bg-black')).not.toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Empty directory')).toBeVisible({ timeout: 10000 });

    // Create .git and .claude directories via the tree API
    const result = await page.evaluate(async () => {
      const { getTree } = await import('/src/store.ts');
      const tree = getTree();

      // Create root with .git and .claude directories and a regular file
      const { cid: emptyDir } = await tree.putDirectory([]);
      const { cid: fileCid, size } = await tree.putFile(new TextEncoder().encode('test content'));

      let { cid: rootCid } = await tree.putDirectory([]);

      // Add .git directory
      rootCid = await tree.setEntry(rootCid, [], '.git', emptyDir, 0, true);

      // Add .claude directory
      rootCid = await tree.setEntry(rootCid, [], '.claude', emptyDir, 0, true);

      // Add a regular file with extension
      rootCid = await tree.setEntry(rootCid, [], 'readme.txt', fileCid, size, false);

      // List the entries
      const entries = await tree.listDirectory(rootCid);

      return {
        entries: entries.map(e => ({ name: e.name, isTree: e.isTree })),
      };
    });

    // Verify .git and .claude are directories, readme.txt is a file
    expect(result.entries).toContainEqual({ name: '.git', isTree: true });
    expect(result.entries).toContainEqual({ name: '.claude', isTree: true });
    expect(result.entries).toContainEqual({ name: 'readme.txt', isTree: false });
  });

  test('looksLikeFile utility should correctly identify files vs directories', async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await waitForNewUserRedirect(page);

    const result = await page.evaluate(async () => {
      const { looksLikeFile } = await import('/src/utils/route.ts');

      return {
        // Should be files (have extension after non-empty prefix)
        'readme.txt': looksLikeFile('readme.txt'),
        'file.js': looksLikeFile('file.js'),
        'image.PNG': looksLikeFile('image.PNG'),
        'doc.md': looksLikeFile('doc.md'),
        'a.b': looksLikeFile('a.b'),

        // Should NOT be files (dotfiles/dotdirs)
        '.git': looksLikeFile('.git'),
        '.claude': looksLikeFile('.claude'),
        '.env': looksLikeFile('.env'),
        '.gitignore': looksLikeFile('.gitignore'),
        '.DS_Store': looksLikeFile('.DS_Store'),
      };
    });

    // Files should return true
    expect(result['readme.txt']).toBe(true);
    expect(result['file.js']).toBe(true);
    expect(result['image.PNG']).toBe(true);
    expect(result['doc.md']).toBe(true);
    expect(result['a.b']).toBe(true);

    // Dotfiles should return false (treated as directories)
    expect(result['.git']).toBe(false);
    expect(result['.claude']).toBe(false);
    expect(result['.env']).toBe(false);
    expect(result['.gitignore']).toBe(false);
    expect(result['.DS_Store']).toBe(false);
  });

  test('should detect git repo and show git features when .git directory exists', async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await waitForNewUserRedirect(page);

    // Navigate to tree list and create a folder
    await page.locator(myTreesButtonSelector).click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'New Folder' }).click();

    const input = page.locator('input[placeholder="Folder name..."]');
    await input.waitFor({ timeout: 5000 });
    await input.fill('git-repo-test');
    await page.click('button:has-text("Create")');

    // Wait for modal to close
    await expect(page.locator('.fixed.inset-0.bg-black')).not.toBeVisible({ timeout: 10000 });

    // Create a minimal git repo structure via the tree API
    const result = await page.evaluate(async () => {
      const { getTree } = await import('/src/store.ts');
      const tree = getTree();

      // Create minimal .git structure
      // .git/HEAD - contains ref to current branch
      // .git/config - basic config
      // .git/refs/heads/main - branch ref
      // .git/objects/ - object store (empty for now)

      const headContent = new TextEncoder().encode('ref: refs/heads/main\n');
      const configContent = new TextEncoder().encode('[core]\n\trepositoryformatversion = 0\n');
      const mainRefContent = new TextEncoder().encode('0000000000000000000000000000000000000000\n');

      const { cid: headCid } = await tree.putFile(headContent);
      const { cid: configCid } = await tree.putFile(configContent);
      const { cid: mainRefCid } = await tree.putFile(mainRefContent);
      const { cid: emptyDir } = await tree.putDirectory([]);

      // Build .git/refs/heads directory with main branch
      let { cid: headsDir } = await tree.putDirectory([]);
      headsDir = await tree.setEntry(headsDir, [], 'main', mainRefCid, mainRefContent.length, false);

      // Build .git/refs directory
      let { cid: refsDir } = await tree.putDirectory([]);
      refsDir = await tree.setEntry(refsDir, [], 'heads', headsDir, 0, true);

      // Build .git directory
      let { cid: gitDir } = await tree.putDirectory([]);
      gitDir = await tree.setEntry(gitDir, [], 'HEAD', headCid, headContent.length, false);
      gitDir = await tree.setEntry(gitDir, [], 'config', configCid, configContent.length, false);
      gitDir = await tree.setEntry(gitDir, [], 'refs', refsDir, 0, true);
      gitDir = await tree.setEntry(gitDir, [], 'objects', emptyDir, 0, true);

      // Build root with .git directory
      let { cid: rootCid } = await tree.putDirectory([]);
      rootCid = await tree.setEntry(rootCid, [], '.git', gitDir, 0, true);

      // Check if it's detected as a git repo
      const { isGitRepo } = await import('/src/utils/git.ts');
      const isRepo = await isGitRepo(rootCid);

      return { isRepo };
    });

    expect(result.isRepo).toBe(true);
  });

  test('.git directory should be uploaded when adding a folder', async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await waitForNewUserRedirect(page);

    // Check that .git is NOT in the default ignore patterns
    const result = await page.evaluate(async () => {
      const { DEFAULT_IGNORE_PATTERNS } = await import('/src/utils/gitignore.ts');

      // Check if any pattern matches .git
      const hasGitIgnore = DEFAULT_IGNORE_PATTERNS.some(p =>
        p.pattern.includes('.git') || p.regex.test('.git')
      );

      return {
        hasGitIgnore,
        patterns: DEFAULT_IGNORE_PATTERNS.map(p => p.pattern)
      };
    });

    // .git should NOT be in default ignore patterns
    expect(result.hasGitIgnore).toBe(false);
    expect(result.patterns).not.toContain('.git/');
    expect(result.patterns).not.toContain('.git');
  });
});
