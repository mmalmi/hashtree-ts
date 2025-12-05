import { test, expect } from '@playwright/test';
import { setupPageErrorHandler, waitForNewUserRedirect, myTreesButtonSelector } from './test-utils.js';

test.describe('Git integration features', () => {
  test('navigating to .git directory should show directory view not file download', async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await waitForNewUserRedirect(page);

    // Navigate to tree list and create a folder
    await page.locator(myTreesButtonSelector).click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'New Folder' }).click();

    const input = page.locator('input[placeholder="Folder name..."]');
    await input.waitFor({ timeout: 5000 });
    await input.fill('nav-dotfile-test');
    await page.click('button:has-text("Create")');

    // Wait for modal to close
    await expect(page.locator('.fixed.inset-0.bg-black')).not.toBeVisible({ timeout: 10000 });

    // Create .git directory
    await page.getByRole('button', { name: 'New Folder' }).click();
    const folderInput = page.locator('input[placeholder="Folder name..."]');
    await folderInput.waitFor({ timeout: 5000 });
    await folderInput.fill('.git');
    await page.click('button:has-text("Create")');
    await expect(page.locator('.fixed.inset-0.bg-black')).not.toBeVisible({ timeout: 10000 });

    // Wait for .git to appear in the file list and click it
    // The entry should be a folder icon with text ".git"
    await page.waitForTimeout(1000); // Wait for tree to update
    const gitEntry = page.locator('button:has-text(".git"), a:has-text(".git")').first();
    await expect(gitEntry).toBeVisible({ timeout: 10000 });

    // Click on .git to navigate into it
    await gitEntry.click();
    await page.waitForTimeout(1000); // Wait for navigation and path resolution

    // Check URL has .git in path
    const url = page.url();
    expect(url).toContain('.git');

    // Should see "Empty directory" message since we're viewing it as a directory
    // NOT a download button for binary file
    const emptyDir = page.locator('text=Empty directory');
    const downloadButton = page.locator('button:has-text("Download")');

    // At least one of these should be true:
    // 1. We see "Empty directory" (correct - viewing as directory)
    // 2. We don't see a Download button (correct - not treating as file)
    const emptyVisible = await emptyDir.isVisible().catch(() => false);
    const downloadVisible = await downloadButton.isVisible().catch(() => false);

    // If we see Download button, we're incorrectly treating .git as a file
    expect(downloadVisible).toBe(false);
  });

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

  test('git repo structure is preserved when uploading .git directory', async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await waitForNewUserRedirect(page);

    // Create a real git repo with commits using CLI
    const fs = await import('fs/promises');
    const path = await import('path');
    const { execSync } = await import('child_process');
    const os = await import('os');

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-test-'));

    try {
      // Initialize git repo and create commits
      execSync('git init', { cwd: tmpDir });
      execSync('git config user.email "test@example.com"', { cwd: tmpDir });
      execSync('git config user.name "Test User"', { cwd: tmpDir });

      // Create first commit
      await fs.writeFile(path.join(tmpDir, 'README.md'), '# Test Repo\n');
      execSync('git add .', { cwd: tmpDir });
      execSync('git commit -m "Initial commit"', { cwd: tmpDir });

      // Create second commit
      await fs.writeFile(path.join(tmpDir, 'file.txt'), 'Hello World\n');
      execSync('git add .', { cwd: tmpDir });
      execSync('git commit -m "Add file.txt"', { cwd: tmpDir });

      // Read all files from the git repo to inject via page.evaluate
      const getAllFiles = async (dir: string, base = ''): Promise<Array<{path: string, content: number[]}>> => {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        const files: Array<{path: string, content: number[]}> = [];
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relativePath = base ? `${base}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            files.push(...await getAllFiles(fullPath, relativePath));
          } else {
            const content = await fs.readFile(fullPath);
            files.push({ path: relativePath, content: Array.from(content) });
          }
        }
        return files;
      };

      const allFiles = await getAllFiles(tmpDir);

      // Inject files directly via tree API
      const result = await page.evaluate(async (files) => {
        const { getTree } = await import('/src/store.ts');
        const tree = getTree();

        // Create root directory
        let { cid: rootCid } = await tree.putDirectory([]);

        // Collect all directory paths and sort by depth
        const dirPaths = new Set<string>();
        for (const file of files) {
          const parts = file.path.split('/');
          for (let i = 1; i < parts.length; i++) {
            dirPaths.add(parts.slice(0, i).join('/'));
          }
        }
        const sortedDirs = Array.from(dirPaths).sort((a, b) =>
          a.split('/').length - b.split('/').length
        );

        // Create directories
        for (const dir of sortedDirs) {
          const parts = dir.split('/');
          const name = parts.pop()!;
          const { cid: emptyDir } = await tree.putDirectory([]);
          rootCid = await tree.setEntry(rootCid, parts, name, emptyDir, 0, true);
        }

        // Add files
        for (const file of files) {
          const parts = file.path.split('/');
          const name = parts.pop()!;
          const data = new Uint8Array(file.content);
          const { cid: fileCid, size } = await tree.putFile(data);
          rootCid = await tree.setEntry(rootCid, parts, name, fileCid, size, false);
        }

        // Verify .git structure was preserved
        const entries = await tree.listDirectory(rootCid);
        const hasGit = entries.some(e => e.name === '.git' && e.isTree);

        if (!hasGit) {
          return { error: 'No .git directory found', hasGit: false };
        }

        // Check HEAD points to a valid ref
        const headRes = await tree.resolvePath(rootCid, '.git/HEAD');
        const headContent = headRes ? new TextDecoder().decode((await tree.readFile(headRes.cid))!) : '';

        // Check refs directory exists
        const refsRes = await tree.resolvePath(rootCid, '.git/refs/heads');
        const refEntries = refsRes ? (await tree.listDirectory(refsRes.cid)).map(e => e.name) : [];

        // Check objects directory has content (2-char subdirs like 30, a8, etc)
        const objectsRes = await tree.resolvePath(rootCid, '.git/objects');
        const objectDirs = objectsRes
          ? (await tree.listDirectory(objectsRes.cid))
              .filter(e => e.isTree && e.name.length === 2)
              .map(e => e.name)
          : [];

        return {
          error: null,
          hasGit,
          headContent: headContent.trim(),
          refEntries,
          objectDirCount: objectDirs.length,
          fileCount: files.length
        };
      }, allFiles);

      // Verify git structure is intact
      expect(result.error).toBeNull();
      expect(result.hasGit).toBe(true);
      expect(result.headContent).toMatch(/^ref: refs\/heads\//); // HEAD points to a branch
      expect(result.refEntries.length).toBeGreaterThan(0); // At least one branch
      expect(result.objectDirCount).toBeGreaterThan(0); // Objects were stored
      expect(result.fileCount).toBeGreaterThan(10); // A real git repo has many files

    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  test('git history should return commits from uploaded git repo', async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await waitForNewUserRedirect(page);

    // Create a real git repo with commits using CLI
    const fs = await import('fs/promises');
    const path = await import('path');
    const { execSync } = await import('child_process');
    const os = await import('os');

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-history-test-'));

    try {
      // Initialize git repo and create commits
      execSync('git init', { cwd: tmpDir });
      execSync('git config user.email "test@example.com"', { cwd: tmpDir });
      execSync('git config user.name "Test User"', { cwd: tmpDir });

      // Create first commit
      await fs.writeFile(path.join(tmpDir, 'README.md'), '# Test Repo\n');
      execSync('git add .', { cwd: tmpDir });
      execSync('git commit -m "Initial commit"', { cwd: tmpDir });

      // Create second commit
      await fs.writeFile(path.join(tmpDir, 'file.txt'), 'Hello World\n');
      execSync('git add .', { cwd: tmpDir });
      execSync('git commit -m "Add file.txt"', { cwd: tmpDir });

      // Read all files and directories from the git repo
      interface FileEntry { type: 'file'; path: string; content: number[]; }
      interface DirEntry { type: 'dir'; path: string; }
      type Entry = FileEntry | DirEntry;

      const getAllEntries = async (dir: string, base = ''): Promise<Entry[]> => {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        const result: Entry[] = [];
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relativePath = base ? `${base}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            // Add the directory itself
            result.push({ type: 'dir', path: relativePath });
            // Recursively get contents
            result.push(...await getAllEntries(fullPath, relativePath));
          } else {
            const content = await fs.readFile(fullPath);
            result.push({ type: 'file', path: relativePath, content: Array.from(content) });
          }
        }
        return result;
      };

      const allEntries = await getAllEntries(tmpDir);
      const allFiles = allEntries.filter((e): e is FileEntry => e.type === 'file');
      const allDirs = allEntries.filter((e): e is DirEntry => e.type === 'dir').map(d => d.path);

      // Upload and test getLog
      const result = await page.evaluate(async ({ files, dirs }) => {
        const { getTree } = await import('/src/store.ts');
        const tree = getTree();

        // Create root directory
        let { cid: rootCid } = await tree.putDirectory([]);

        // Collect all directory paths from both explicit dirs and parent dirs of files
        const dirPaths = new Set<string>(dirs);
        for (const file of files) {
          const parts = file.path.split('/');
          for (let i = 1; i < parts.length; i++) {
            dirPaths.add(parts.slice(0, i).join('/'));
          }
        }
        const sortedDirs = Array.from(dirPaths).sort((a, b) =>
          a.split('/').length - b.split('/').length
        );

        // Create directories (including empty ones)
        for (const dir of sortedDirs) {
          const parts = dir.split('/');
          const name = parts.pop()!;
          const { cid: emptyDir } = await tree.putDirectory([]);
          rootCid = await tree.setEntry(rootCid, parts, name, emptyDir, 0, true);
        }

        // Add files
        for (const file of files) {
          const parts = file.path.split('/');
          const name = parts.pop()!;
          const data = new Uint8Array(file.content);
          const { cid: fileCid, size } = await tree.putFile(data);
          rootCid = await tree.setEntry(rootCid, parts, name, fileCid, size, false);
        }

        // Test getLog
        const { getLog } = await import('/src/utils/git.ts');

        try {
          const commits = await getLog(rootCid);
          return {
            success: true,
            commitCount: commits.length,
            commits: commits.map(c => ({
              message: c.message.trim(),
              author: c.author
            })),
            error: null
          };
        } catch (err) {
          return {
            success: false,
            commitCount: 0,
            commits: [],
            error: err instanceof Error ? err.message : String(err)
          };
        }
      }, { files: allFiles, dirs: allDirs });

      // Verify we got commits
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
      expect(result.commitCount).toBeGreaterThanOrEqual(2);
      expect(result.commits.some((c: {message: string}) => c.message.includes('Initial commit'))).toBe(true);
      expect(result.commits.some((c: {message: string}) => c.message.includes('Add file.txt'))).toBe(true);

    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  test('git history modal should handle repos without commits gracefully', async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await waitForNewUserRedirect(page);

    // Test getLog with a minimal .git structure that has no actual commits
    const result = await page.evaluate(async () => {
      const { getTree } = await import('/src/store.ts');
      const tree = getTree();

      // Create minimal .git structure with HEAD pointing to non-existent ref
      const headContent = new TextEncoder().encode('ref: refs/heads/main\n');
      const { cid: headCid } = await tree.putFile(headContent);
      const { cid: emptyDir } = await tree.putDirectory([]);

      // Build .git/refs/heads (empty - no actual branch files)
      let { cid: headsDir } = await tree.putDirectory([]);

      // Build .git/refs directory
      let { cid: refsDir } = await tree.putDirectory([]);
      refsDir = await tree.setEntry(refsDir, [], 'heads', headsDir, 0, true);

      // Build .git directory
      let { cid: gitDir } = await tree.putDirectory([]);
      gitDir = await tree.setEntry(gitDir, [], 'HEAD', headCid, headContent.length, false);
      gitDir = await tree.setEntry(gitDir, [], 'refs', refsDir, 0, true);
      gitDir = await tree.setEntry(gitDir, [], 'objects', emptyDir, 0, true);

      // Build root with .git directory
      let { cid: rootCid } = await tree.putDirectory([]);
      rootCid = await tree.setEntry(rootCid, [], '.git', gitDir, 0, true);

      // Try to get log - should not throw, should return empty array
      const { getLog } = await import('/src/utils/git.ts');

      try {
        const commits = await getLog(rootCid);
        return {
          success: true,
          commits,
          error: null
        };
      } catch (err) {
        return {
          success: false,
          commits: null,
          error: err instanceof Error ? err.message : String(err)
        };
      }
    });

    // getLog should succeed and return empty array (not throw)
    expect(result.success).toBe(true);
    expect(result.commits).toEqual([]);
    expect(result.error).toBeNull();
  });

});
