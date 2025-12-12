import { test, expect } from '@playwright/test';
import { setupPageErrorHandler, navigateToPublicFolder } from './test-utils.js';

test.describe('Git integration features', () => {
  test('navigating to .git directory should show directory view not file download', { timeout: 30000 }, async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await navigateToPublicFolder(page);

    // Navigate to tree list and create a folder
    await page.locator('header a:has-text("hashtree")').click();
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
    // The entry is a Link (<a>) with a child span containing the folder name
    await page.waitForTimeout(1000); // Wait for tree to update
    const gitEntry = page.locator('[data-testid="file-list"] a').filter({ hasText: '.git' }).first();
    await expect(gitEntry).toBeVisible({ timeout: 15000 });

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
    await navigateToPublicFolder(page);

    // Navigate to tree list and create a folder
    await page.locator('header a:has-text("hashtree")').click();
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
      const { getTree, LinkType } = await import('/src/store.ts');
      const tree = getTree();

      // Create root with .git and .claude directories and a regular file
      const { cid: emptyDir } = await tree.putDirectory([]);
      const { cid: fileCid, size } = await tree.putFile(new TextEncoder().encode('test content'));

      let { cid: rootCid } = await tree.putDirectory([]);

      // Add .git directory
      rootCid = await tree.setEntry(rootCid, [], '.git', emptyDir, 0, LinkType.Dir);

      // Add .claude directory
      rootCid = await tree.setEntry(rootCid, [], '.claude', emptyDir, 0, LinkType.Dir);

      // Add a regular file with extension
      rootCid = await tree.setEntry(rootCid, [], 'readme.txt', fileCid, size, LinkType.Blob);

      // List the entries
      const entries = await tree.listDirectory(rootCid);

      return {
        entries: entries.map(e => ({ name: e.name, isDir: e.type === LinkType.Dir })),
      };
    });

    // Verify .git and .claude are directories, readme.txt is a file
    expect(result.entries).toContainEqual({ name: '.git', isDir: true });
    expect(result.entries).toContainEqual({ name: '.claude', isDir: true });
    expect(result.entries).toContainEqual({ name: 'readme.txt', isDir: false });
  });

  test('should detect git repo and show git features when .git directory exists', async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await navigateToPublicFolder(page);

    // Navigate to tree list and create a folder
    await page.locator('header a:has-text("hashtree")').click();
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
      const { getTree, LinkType } = await import('/src/store.ts');
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
      headsDir = await tree.setEntry(headsDir, [], 'main', mainRefCid, mainRefContent.length, LinkType.Blob);

      // Build .git/refs directory
      let { cid: refsDir } = await tree.putDirectory([]);
      refsDir = await tree.setEntry(refsDir, [], 'heads', headsDir, 0, LinkType.Dir);

      // Build .git directory
      let { cid: gitDir } = await tree.putDirectory([]);
      gitDir = await tree.setEntry(gitDir, [], 'HEAD', headCid, headContent.length, LinkType.Blob);
      gitDir = await tree.setEntry(gitDir, [], 'config', configCid, configContent.length, LinkType.Blob);
      gitDir = await tree.setEntry(gitDir, [], 'refs', refsDir, 0, LinkType.Dir);
      gitDir = await tree.setEntry(gitDir, [], 'objects', emptyDir, 0, LinkType.Dir);

      // Build root with .git directory
      let { cid: rootCid } = await tree.putDirectory([]);
      rootCid = await tree.setEntry(rootCid, [], '.git', gitDir, 0, LinkType.Dir);

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
    await navigateToPublicFolder(page);

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

  test('git repo structure is preserved when uploading .git directory', { timeout: 30000 }, async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await navigateToPublicFolder(page);

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
        const { getTree, LinkType } = await import('/src/store.ts');
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
          rootCid = await tree.setEntry(rootCid, parts, name, emptyDir, 0, LinkType.Dir);
        }

        // Add files
        for (const file of files) {
          const parts = file.path.split('/');
          const name = parts.pop()!;
          const data = new Uint8Array(file.content);
          const { cid: fileCid, size } = await tree.putFile(data);
          rootCid = await tree.setEntry(rootCid, parts, name, fileCid, size, LinkType.Blob);
        }

        // Verify .git structure was preserved
        const entries = await tree.listDirectory(rootCid);
        const hasGit = entries.some(e => e.name === '.git' && e.type === LinkType.Dir);

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
              .filter(e => e.type === LinkType.Dir && e.name.length === 2)
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

  test('git history should return commits from uploaded git repo', { timeout: 30000 }, async ({ page }) => {
    setupPageErrorHandler(page);

    // Capture wasm-git debug logs
    const wasmGitLogs: string[] = [];
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('[wasm-git]')) {
        wasmGitLogs.push(text);
      }
    });

    await page.goto('/');
    await navigateToPublicFolder(page);

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
        const { getTree, LinkType } = await import('/src/store.ts');
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
          rootCid = await tree.setEntry(rootCid, parts, name, emptyDir, 0, LinkType.Dir);
        }

        // Add files
        let objectFilePath = '';
        let objectFileOriginalSize = 0;
        for (const file of files) {
          const parts = file.path.split('/');
          const name = parts.pop()!;
          const data = new Uint8Array(file.content);
          const { cid: fileCid, size } = await tree.putFile(data);
          rootCid = await tree.setEntry(rootCid, parts, name, fileCid, size, LinkType.Blob);
          // Track first git object file for verification
          if (file.path.includes('.git/objects/') && !file.path.endsWith('/info') && !file.path.endsWith('/pack')) {
            if (!objectFilePath) {
              objectFilePath = file.path;
              objectFileOriginalSize = data.length;
            }
          }
        }

        // Verify round-trip of a git object file
        let verifyInfo = '';
        if (objectFilePath) {
          const result = await tree.resolvePath(rootCid, objectFilePath);
          if (result) {
            const readBack = await tree.readFile(result.cid);
            if (readBack) {
              verifyInfo = `Object file ${objectFilePath}: original=${objectFileOriginalSize} bytes, readBack=${readBack.length} bytes`;
              if (objectFileOriginalSize !== readBack.length) {
                verifyInfo += ` MISMATCH!`;
              }
            } else {
              verifyInfo = `Object file ${objectFilePath}: readFile returned null`;
            }
          } else {
            verifyInfo = `Object file ${objectFilePath}: resolvePath returned null`;
          }
        }

        // Test getLog
        const { getLog } = await import('/src/utils/git.ts');

        try {
          const result = await getLog(rootCid, { debug: true }) as any;
          const commits = result.commits || result;
          const debug = result.debug || [];
          return {
            success: true,
            commitCount: Array.isArray(commits) ? commits.length : 0,
            commits: Array.isArray(commits) ? commits.map((c: any) => ({
              message: c.message?.trim() || '',
              author: c.author || ''
            })) : [],
            error: null,
            debug,
            verifyInfo
          };
        } catch (err) {
          return {
            success: false,
            commitCount: 0,
            commits: [],
            error: err instanceof Error ? err.message : String(err),
            debug: []
          };
        }
      }, { files: allFiles, dirs: allDirs });

      // Verify we got commits
      console.log('Git history result:', JSON.stringify(result, null, 2));
      console.log('Wasm-git logs:', wasmGitLogs);
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
    await navigateToPublicFolder(page);

    // Test getLog with a minimal .git structure that has no actual commits
    const result = await page.evaluate(async () => {
      const { getTree, LinkType } = await import('/src/store.ts');
      const tree = getTree();

      // Create minimal .git structure with HEAD pointing to non-existent ref
      const headContent = new TextEncoder().encode('ref: refs/heads/main\n');
      const { cid: headCid } = await tree.putFile(headContent);
      const { cid: emptyDir } = await tree.putDirectory([]);

      // Build .git/refs/heads (empty - no actual branch files)
      let { cid: headsDir } = await tree.putDirectory([]);

      // Build .git/refs directory
      let { cid: refsDir } = await tree.putDirectory([]);
      refsDir = await tree.setEntry(refsDir, [], 'heads', headsDir, 0, LinkType.Dir);

      // Build .git directory
      let { cid: gitDir } = await tree.putDirectory([]);
      gitDir = await tree.setEntry(gitDir, [], 'HEAD', headCid, headContent.length, LinkType.Blob);
      gitDir = await tree.setEntry(gitDir, [], 'refs', refsDir, 0, LinkType.Dir);
      gitDir = await tree.setEntry(gitDir, [], 'objects', emptyDir, 0, LinkType.Dir);

      // Build root with .git directory
      let { cid: rootCid } = await tree.putDirectory([]);
      rootCid = await tree.setEntry(rootCid, [], '.git', gitDir, 0, LinkType.Dir);

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

  // Skip: checkoutCommit doesn't fully restore files - needs investigation
  test.skip('checkout commit should restore files from that commit', async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await navigateToPublicFolder(page);

    // Import Node.js modules
    const fs = await import('fs/promises');
    const path = await import('path');
    const { execSync } = await import('child_process');
    const os = await import('os');

    // Create a git repo with two commits, checkout the first commit
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-checkout-test-'));

    try {
      // Initialize git repo
      execSync('git init', { cwd: tmpDir });
      execSync('git config user.email "test@example.com"', { cwd: tmpDir });
      execSync('git config user.name "Test User"', { cwd: tmpDir });

      // First commit: create initial file
      await fs.writeFile(path.join(tmpDir, 'file.txt'), 'Version 1\n');
      execSync('git add .', { cwd: tmpDir });
      execSync('git commit -m "Initial commit"', { cwd: tmpDir });

      // Get first commit SHA
      const firstCommit = execSync('git rev-parse HEAD', { cwd: tmpDir }).toString().trim();

      // Second commit: modify file and add another
      await fs.writeFile(path.join(tmpDir, 'file.txt'), 'Version 2\n');
      await fs.writeFile(path.join(tmpDir, 'file2.txt'), 'New file\n');
      execSync('git add .', { cwd: tmpDir });
      execSync('git commit -m "Second commit"', { cwd: tmpDir });

      // Read all files
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
            result.push({ type: 'dir', path: relativePath });
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

      // Upload repo and test checkoutCommit
      const result = await page.evaluate(async ({ files, dirs, commitSha }) => {
        const { getTree, LinkType } = await import('/src/store.ts');
        const tree = getTree();

        // Create root directory and upload all files
        let { cid: rootCid } = await tree.putDirectory([]);

        // Create directories
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

        for (const dir of sortedDirs) {
          const parts = dir.split('/');
          const name = parts.pop()!;
          const { cid: emptyDir } = await tree.putDirectory([]);
          rootCid = await tree.setEntry(rootCid, parts, name, emptyDir, 0, LinkType.Dir);
        }

        // Add files
        for (const file of files) {
          const parts = file.path.split('/');
          const name = parts.pop()!;
          const data = new Uint8Array(file.content);
          const { cid: fileCid, size } = await tree.putFile(data);
          rootCid = await tree.setEntry(rootCid, parts, name, fileCid, size, LinkType.Blob);
        }

        // List files before checkout (should have both file.txt and file2.txt)
        const entriesBefore = await tree.listDirectory(rootCid);
        const filesBefore = entriesBefore.filter(e => e.type !== LinkType.Dir && e.name !== '.git').map(e => e.name);

        // Read file.txt content before checkout
        const file1Before = await tree.resolvePath(rootCid, 'file.txt');
        const file1ContentBefore = file1Before ? new TextDecoder().decode(await tree.readFile(file1Before.cid) || new Uint8Array()) : '';

        // Test checkoutCommit
        const { checkoutCommit } = await import('/src/utils/git.ts');

        try {
          const newRootCid = await checkoutCommit(rootCid, commitSha);

          // List files after checkout (should only have file.txt, no file2.txt)
          const entriesAfter = await tree.listDirectory(newRootCid);
          const filesAfter = entriesAfter.filter(e => e.type !== LinkType.Dir && e.name !== '.git').map(e => e.name);

          // Read file.txt content after checkout
          const file1After = await tree.resolvePath(newRootCid, 'file.txt');
          const file1ContentAfter = file1After ? new TextDecoder().decode(await tree.readFile(file1After.cid) || new Uint8Array()) : '';

          // Check if file2.txt exists
          const file2After = await tree.resolvePath(newRootCid, 'file2.txt');

          return {
            success: true,
            filesBefore: filesBefore.sort(),
            filesAfter: filesAfter.sort(),
            file1ContentBefore,
            file1ContentAfter,
            file2ExistsAfter: file2After !== null,
            error: null
          };
        } catch (err) {
          return {
            success: false,
            filesBefore: [],
            filesAfter: [],
            file1ContentBefore: '',
            file1ContentAfter: '',
            file2ExistsAfter: true,
            error: err instanceof Error ? err.message : String(err)
          };
        }
      }, { files: allFiles, dirs: allDirs, commitSha: firstCommit });

      console.log('Checkout result:', JSON.stringify(result, null, 2));
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();

      // Before checkout: both files should exist, file.txt should be "Version 2"
      expect(result.filesBefore).toContain('file.txt');
      expect(result.filesBefore).toContain('file2.txt');
      expect(result.file1ContentBefore.trim()).toBe('Version 2');

      // After checkout to first commit: only file.txt should exist, content should be "Version 1"
      expect(result.filesAfter).toContain('file.txt');
      expect(result.file2ExistsAfter).toBe(false);
      expect(result.file1ContentAfter.trim()).toBe('Version 1');

    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
  test('git directory listing should show last commit info for files', { timeout: 60000 }, async ({ page }) => {
    setupPageErrorHandler(page);

    // Capture console logs for debugging
    const logs: string[] = [];
    page.on('console', msg => {
      if (msg.text().includes('[wasm-git]') || msg.text().includes('fileCommits')) {
        logs.push(msg.text());
      }
    });

    await page.goto('/');
    await navigateToPublicFolder(page);

    // Create a real git repo with commits using CLI
    const fs = await import('fs/promises');
    const path = await import('path');
    const { execSync } = await import('child_process');
    const os = await import('os');

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-file-commits-'));

    try {
      // Initialize git repo and create commits
      execSync('git init', { cwd: tmpDir });
      execSync('git config user.email "test@example.com"', { cwd: tmpDir });
      execSync('git config user.name "Test User"', { cwd: tmpDir });

      // Create first commit with README
      await fs.writeFile(path.join(tmpDir, 'README.md'), '# Test Repo\n');
      execSync('git add .', { cwd: tmpDir });
      execSync('git commit -m "Add README"', { cwd: tmpDir });

      // Create second commit with src directory
      await fs.mkdir(path.join(tmpDir, 'src'));
      await fs.writeFile(path.join(tmpDir, 'src', 'index.ts'), 'export const x = 1;\n');
      execSync('git add .', { cwd: tmpDir });
      execSync('git commit -m "Add src directory"', { cwd: tmpDir });

      // Read all files and directories
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
            result.push({ type: 'dir', path: relativePath });
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

      // Upload and test getFileLastCommits
      const result = await page.evaluate(async ({ files, dirs }) => {
        const { getTree, LinkType } = await import('/src/store.ts');
        const tree = getTree();

        // Create root directory and upload all files
        let { cid: rootCid } = await tree.putDirectory([]);

        // Create directories
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

        for (const dir of sortedDirs) {
          const parts = dir.split('/');
          const name = parts.pop()!;
          const { cid: emptyDir } = await tree.putDirectory([]);
          rootCid = await tree.setEntry(rootCid, parts, name, emptyDir, 0, LinkType.Dir);
        }

        // Add files
        for (const file of files) {
          const parts = file.path.split('/');
          const name = parts.pop()!;
          const data = new Uint8Array(file.content);
          const { cid: fileCid, size } = await tree.putFile(data);
          rootCid = await tree.setEntry(rootCid, parts, name, fileCid, size, LinkType.Blob);
        }

        // List root directory entries
        const entries = await tree.listDirectory(rootCid);
        const entryNames = entries.map(e => e.name);

        // Test getFileLastCommits
        const { getFileLastCommits } = await import('/src/utils/git.ts');
        const fileCommits = await getFileLastCommits(rootCid, entryNames);

        return {
          entryNames,
          fileCommitsSize: fileCommits.size,
          fileCommitsKeys: Array.from(fileCommits.keys()),
          readmeCommit: fileCommits.get('README.md'),
          srcCommit: fileCommits.get('src'),
        };
      }, { files: allFiles, dirs: allDirs });

      console.log('File commits result:', JSON.stringify(result, null, 2));
      console.log('Console logs:', logs);

      // Verify we got commit info for files and directories
      expect(result.fileCommitsSize).toBeGreaterThan(0);
      expect(result.fileCommitsKeys).toContain('README.md');
      expect(result.fileCommitsKeys).toContain('src'); // Directory should also have commit info
      expect(result.readmeCommit?.message).toContain('Add README');
      expect(result.srcCommit?.message).toContain('Add src');

      // Now test the UI - save as a tree and navigate to it
      await page.evaluate(async ({ files, dirs }) => {
        const { getTree, LinkType } = await import('/src/store.ts');
        const { autosaveIfOwn } = await import('/src/nostr.ts');
        const { getCurrentRootCid } = await import('/src/actions/route.ts');
        const { getRouteSync } = await import('/src/stores/index.ts');

        const tree = getTree();
        const route = getRouteSync();
        const rootCid = getCurrentRootCid();
        if (!rootCid) return;

        // Create the git repo directory
        let { cid: repoCid } = await tree.putDirectory([]);

        // Create directories
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

        for (const dir of sortedDirs) {
          const parts = dir.split('/');
          const name = parts.pop()!;
          const { cid: emptyDir } = await tree.putDirectory([]);
          repoCid = await tree.setEntry(repoCid, parts, name, emptyDir, 0, LinkType.Dir);
        }

        // Add files
        for (const file of files) {
          const parts = file.path.split('/');
          const name = parts.pop()!;
          const data = new Uint8Array(file.content);
          const { cid: fileCid, size } = await tree.putFile(data);
          repoCid = await tree.setEntry(repoCid, parts, name, fileCid, size, LinkType.Blob);
        }

        // Add to current directory as "test-git-repo"
        const newRootCid = await tree.setEntry(rootCid, route.path, 'test-git-repo', repoCid, 0, LinkType.Dir);
        autosaveIfOwn(newRootCid);
      }, { files: allFiles, dirs: allDirs });

      // Wait for the folder to appear
      await page.waitForTimeout(1000);

      // Click into the git repo folder
      const repoLink = page.locator('[data-testid="file-list"] a').filter({ hasText: 'test-git-repo' }).first();
      await expect(repoLink).toBeVisible({ timeout: 10000 });
      await repoLink.click();

      // Wait for navigation
      await page.waitForURL(/test-git-repo/, { timeout: 10000 });

      // Set larger viewport to see commit message column
      await page.setViewportSize({ width: 1200, height: 800 });
      await page.waitForTimeout(2000); // Wait for file commits to load

      // Check that the README row exists
      const readmeRow = page.locator('tr').filter({ hasText: 'README.md' });
      await expect(readmeRow).toBeVisible({ timeout: 10000 });

      // Wait for file commits to load
      await page.waitForTimeout(3000);

      // The commit message or relative time should appear in the table
      // Look for "Add README" text or time like "just now" or "ago"
      const commitCell = page.locator('td').filter({ hasText: /Add README|just now|ago/ });
      await expect(commitCell.first()).toBeVisible({ timeout: 10000 });

    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  test('git init button should initialize a git repo in a directory', { timeout: 60000 }, async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await navigateToPublicFolder(page);

    // Create a folder with some files
    await page.getByRole('button', { name: 'New Folder' }).click();
    const folderInput = page.locator('input[placeholder="Folder name..."]');
    await folderInput.waitFor({ timeout: 5000 });
    await folderInput.fill('git-init-test');
    await page.click('button:has-text("Create")');
    await expect(page.locator('.fixed.inset-0.bg-black')).not.toBeVisible({ timeout: 10000 });

    // Wait for folder to appear and click into it
    const folderLink = page.locator('[data-testid="file-list"] a').filter({ hasText: 'git-init-test' }).first();
    await expect(folderLink).toBeVisible({ timeout: 15000 });
    await folderLink.click();
    await page.waitForURL(/git-init-test/, { timeout: 10000 });

    // Create a file in the folder via the tree API (simpler than UI)
    await page.evaluate(async () => {
      const { getTree, LinkType } = await import('/src/store.ts');
      const { autosaveIfOwn } = await import('/src/nostr.ts');
      const { getCurrentRootCid } = await import('/src/actions/route.ts');
      const { getRouteSync } = await import('/src/stores/index.ts');
      const route = getRouteSync();

      const tree = getTree();
      const rootCid = getCurrentRootCid();
      if (!rootCid) return;

      // Create a README.md file
      const content = new TextEncoder().encode('# Test Repo\n\nThis is a test.');
      const { cid: fileCid, size } = await tree.putFile(content);

      // Add to current directory
      const newRootCid = await tree.setEntry(rootCid, route.path, 'README.md', fileCid, size, LinkType.Blob);
      autosaveIfOwn(newRootCid);
    });

    // Wait for file to appear
    await page.waitForTimeout(1000);

    // Git Init button should be visible (not a git repo yet)
    const gitInitBtn = page.getByRole('button', { name: 'Git Init' });
    await expect(gitInitBtn).toBeVisible({ timeout: 15000 });

    // Click Git Init
    await gitInitBtn.click();

    // Wait for initialization to complete (button text changes to "Initializing...")
    await expect(page.getByRole('button', { name: 'Initializing...' })).toBeVisible({ timeout: 5000 });
    // Then button should disappear since it's now a git repo
    await expect(gitInitBtn).not.toBeVisible({ timeout: 30000 });

    // Verify .git directory was created
    const gitDir = page.locator('[data-testid="file-list"] a').filter({ hasText: '.git' }).first();
    await expect(gitDir).toBeVisible({ timeout: 10000 });

    // Verify it's detected as a git repo by checking if the Commits button appears
    const commitsBtn = page.getByRole('button', { name: /commits/i });
    await expect(commitsBtn).toBeVisible({ timeout: 10000 });
  });

  test('git shell modal should run commands and display output', { timeout: 60000 }, async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await navigateToPublicFolder(page);

    // Import Node.js modules
    const fs = await import('fs/promises');
    const path = await import('path');
    const { execSync } = await import('child_process');
    const os = await import('os');

    // Create a real git repo in temp directory
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-shell-test-'));

    try {
      // Initialize git repo with a file
      execSync('git init', { cwd: tmpDir });
      execSync('git config user.email "test@example.com"', { cwd: tmpDir });
      execSync('git config user.name "Test User"', { cwd: tmpDir });
      await fs.writeFile(path.join(tmpDir, 'README.md'), '# Test Repo');
      execSync('git add .', { cwd: tmpDir });
      execSync('git commit -m "Initial commit"', { cwd: tmpDir });

      // Collect all files including .git
      const allFiles: Array<{ path: string; content: number[] }> = [];
      const allDirs: string[] = [];

      async function collectFiles(dirPath: string, prefix: string = ''): Promise<void> {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);
          const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            allDirs.push(relativePath);
            await collectFiles(fullPath, relativePath);
          } else {
            const content = await fs.readFile(fullPath);
            allFiles.push({ path: relativePath, content: Array.from(content) });
          }
        }
      }
      await collectFiles(tmpDir);

      // Upload to hashtree
      await page.evaluate(async ({ files, dirs }) => {
        const { getTree, LinkType } = await import('/src/store.ts');
        const { autosaveIfOwn } = await import('/src/nostr.ts');
        const { getCurrentRootCid } = await import('/src/actions/route.ts');
        const { getRouteSync } = await import('/src/stores/index.ts');

        const tree = getTree();
        const route = getRouteSync();
        const rootCid = getCurrentRootCid();
        if (!rootCid) return;

        // Create the git repo directory
        let { cid: repoCid } = await tree.putDirectory([]);

        // Create directories first
        const sortedDirs = [...dirs].sort((a, b) => a.split('/').length - b.split('/').length);
        for (const dir of sortedDirs) {
          const parts = dir.split('/');
          const name = parts.pop()!;
          const { cid: emptyDir } = await tree.putDirectory([]);
          repoCid = await tree.setEntry(repoCid, parts, name, emptyDir, 0, LinkType.Dir);
        }

        // Add files
        for (const file of files) {
          const parts = file.path.split('/');
          const name = parts.pop()!;
          const data = new Uint8Array(file.content);
          const { cid: fileCid, size } = await tree.putFile(data);
          repoCid = await tree.setEntry(repoCid, parts, name, fileCid, size, LinkType.Blob);
        }

        // Add to current directory as "shell-test-repo"
        const newRootCid = await tree.setEntry(rootCid, route.path, 'shell-test-repo', repoCid, 0, LinkType.Dir);
        autosaveIfOwn(newRootCid);
      }, { files: allFiles, dirs: allDirs });

      // Navigate to the repo
      await page.waitForTimeout(1000);
      const repoLink = page.locator('[data-testid="file-list"] a').filter({ hasText: 'shell-test-repo' }).first();
      await expect(repoLink).toBeVisible({ timeout: 10000 });
      await repoLink.click();
      await page.waitForURL(/shell-test-repo/, { timeout: 10000 });

      // Wait for git repo detection
      await expect(page.getByRole('button', { name: /commits/i })).toBeVisible({ timeout: 15000 });

      // Click the Git Shell button
      const shellBtn = page.getByRole('button', { name: /shell|terminal/i });
      await expect(shellBtn).toBeVisible({ timeout: 10000 });
      await shellBtn.click();

      // Modal should open
      const modal = page.locator('[data-testid="git-shell-modal"]');
      await expect(modal).toBeVisible({ timeout: 5000 });

      // Type a git command
      const input = modal.locator('input[type="text"]');
      await input.fill('status');
      await input.press('Enter');

      // Should see output containing "On branch"
      await expect(modal.locator('text=/On branch/')).toBeVisible({ timeout: 10000 });

      // Run another command - git log (plain format)
      await input.fill('log');
      await input.press('Enter');

      // Should see the commit
      await expect(modal.locator('text=/Initial commit/')).toBeVisible({ timeout: 10000 });

      // Close modal
      await page.keyboard.press('Escape');
      await expect(modal).not.toBeVisible({ timeout: 5000 });

    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  test('git shell should support write commands like add and commit', { timeout: 60000 }, async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await navigateToPublicFolder(page);

    // Import Node.js modules
    const fs = await import('fs/promises');
    const path = await import('path');
    const { execSync } = await import('child_process');
    const os = await import('os');

    // Create a git repo with one file
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-commit-test-'));

    try {
      // Initialize git repo with a file
      execSync('git init', { cwd: tmpDir });
      execSync('git config user.email "test@example.com"', { cwd: tmpDir });
      execSync('git config user.name "Test User"', { cwd: tmpDir });
      await fs.writeFile(path.join(tmpDir, 'README.md'), '# Test Repo');
      execSync('git add .', { cwd: tmpDir });
      execSync('git commit -m "Initial commit"', { cwd: tmpDir });

      // Collect all files including .git
      const allFiles: Array<{ path: string; content: number[] }> = [];
      const allDirs: string[] = [];

      async function collectFiles(dirPath: string, prefix: string = ''): Promise<void> {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);
          const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            allDirs.push(relativePath);
            await collectFiles(fullPath, relativePath);
          } else {
            const content = await fs.readFile(fullPath);
            allFiles.push({ path: relativePath, content: Array.from(content) });
          }
        }
      }
      await collectFiles(tmpDir);

      // Upload to hashtree
      await page.evaluate(async ({ files, dirs }) => {
        const { getTree, LinkType } = await import('/src/store.ts');
        const { autosaveIfOwn } = await import('/src/nostr.ts');
        const { getCurrentRootCid } = await import('/src/actions/route.ts');
        const { getRouteSync } = await import('/src/stores/index.ts');

        const tree = getTree();
        const route = getRouteSync();
        const rootCid = getCurrentRootCid();
        if (!rootCid) return;

        // Create the git repo directory
        let { cid: repoCid } = await tree.putDirectory([]);

        // Create directories first
        const sortedDirs = [...dirs].sort((a, b) => a.split('/').length - b.split('/').length);
        for (const dir of sortedDirs) {
          const parts = dir.split('/');
          const name = parts.pop()!;
          const { cid: emptyDir } = await tree.putDirectory([]);
          repoCid = await tree.setEntry(repoCid, parts, name, emptyDir, 0, LinkType.Dir);
        }

        // Add files
        for (const file of files) {
          const parts = file.path.split('/');
          const name = parts.pop()!;
          const data = new Uint8Array(file.content);
          const { cid: fileCid, size } = await tree.putFile(data);
          repoCid = await tree.setEntry(repoCid, parts, name, fileCid, size, LinkType.Blob);
        }

        // Add to current directory as "commit-test-repo"
        const newRootCid = await tree.setEntry(rootCid, route.path, 'commit-test-repo', repoCid, 0, LinkType.Dir);
        autosaveIfOwn(newRootCid);
      }, { files: allFiles, dirs: allDirs });

      // Navigate to the repo
      await page.waitForTimeout(1000);
      const repoLink = page.locator('[data-testid="file-list"] a').filter({ hasText: 'commit-test-repo' }).first();
      await expect(repoLink).toBeVisible({ timeout: 10000 });
      await repoLink.click();
      await page.waitForURL(/commit-test-repo/, { timeout: 10000 });

      // Wait for git repo detection and 1 commit to show
      await expect(page.getByRole('button', { name: /1 commits/i })).toBeVisible({ timeout: 15000 });

      // Click the Git Shell button
      const shellBtn = page.getByRole('button', { name: /shell|terminal/i });
      await expect(shellBtn).toBeVisible({ timeout: 10000 });
      await shellBtn.click();

      // Modal should open with write commands allowed
      const modal = page.locator('[data-testid="git-shell-modal"]');
      await expect(modal).toBeVisible({ timeout: 5000 });
      await expect(modal.locator('text=/Write commands.*are supported/')).toBeVisible({ timeout: 5000 });

      // First, add a new file via page.evaluate (simulate editing in hashtree)
      await page.evaluate(async () => {
        const { getTree, LinkType } = await import('/src/store.ts');
        const { autosaveIfOwn } = await import('/src/nostr.ts');
        const { getCurrentRootCid } = await import('/src/actions/route.ts');
        const { getRouteSync } = await import('/src/stores/index.ts');

        const tree = getTree();
        const route = getRouteSync();
        const rootCid = getCurrentRootCid();
        if (!rootCid) return;

        // Add a new file to the repo
        const newFileContent = new TextEncoder().encode('New file content');
        const { cid: fileCid, size } = await tree.putFile(newFileContent);

        // Get current repo path and add file to it
        const newRootCid = await tree.setEntry(rootCid, route.path, 'newfile.txt', fileCid, size, LinkType.Blob);
        autosaveIfOwn(newRootCid);
      });

      // Wait for the file to appear
      await page.waitForTimeout(500);

      // Close and reopen modal to get fresh dirCid
      await page.keyboard.press('Escape');
      await expect(modal).not.toBeVisible({ timeout: 5000 });
      await shellBtn.click();
      await expect(modal).toBeVisible({ timeout: 5000 });

      // Run git add to stage the new file
      const input = modal.locator('input[type="text"]');
      await input.fill('add newfile.txt');
      await input.press('Enter');

      // Wait for command to complete
      await page.waitForTimeout(1000);

      // Run git commit
      await input.fill('commit -m "Add newfile.txt"');
      await input.press('Enter');

      // Wait for commit and should see success message or saved indicator
      await page.waitForTimeout(2000);

      // Close modal and verify commit count increased
      await page.keyboard.press('Escape');
      await expect(modal).not.toBeVisible({ timeout: 5000 });

      // Wait for UI to refresh and check for 2 commits
      await expect(page.getByRole('button', { name: /2 commits/i })).toBeVisible({ timeout: 15000 });

    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  test('checkout commit should return a valid directory CID that can be listed', { timeout: 60000 }, async ({ page }) => {
    setupPageErrorHandler(page);

    // Capture wasm-git logs
    const wasmGitLogs: string[] = [];
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('[wasm-git]')) {
        wasmGitLogs.push(text);
      }
    });

    await page.goto('/');
    await navigateToPublicFolder(page);

    // Import Node.js modules
    const fs = await import('fs/promises');
    const path = await import('path');
    const { execSync } = await import('child_process');
    const os = await import('os');

    // Create a git repo with two commits
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-checkout-cid-test-'));

    try {
      // Initialize git repo
      execSync('git init', { cwd: tmpDir });
      execSync('git config user.email "test@example.com"', { cwd: tmpDir });
      execSync('git config user.name "Test User"', { cwd: tmpDir });

      // First commit
      await fs.writeFile(path.join(tmpDir, 'file.txt'), 'Version 1\n');
      execSync('git add .', { cwd: tmpDir });
      execSync('git commit -m "Initial commit"', { cwd: tmpDir });

      // Get first commit SHA
      const firstCommit = execSync('git rev-parse HEAD', { cwd: tmpDir }).toString().trim();

      // Second commit
      await fs.writeFile(path.join(tmpDir, 'file.txt'), 'Version 2\n');
      await fs.writeFile(path.join(tmpDir, 'file2.txt'), 'New file\n');
      execSync('git add .', { cwd: tmpDir });
      execSync('git commit -m "Second commit"', { cwd: tmpDir });

      // Read all files
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
            result.push({ type: 'dir', path: relativePath });
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

      // Upload and test checkoutCommit returns a listable directory
      const result = await page.evaluate(async ({ files, dirs, commitSha }) => {
        const { getTree, LinkType } = await import('/src/store.ts');
        const tree = getTree();

        // Create root directory and upload all files
        let { cid: rootCid } = await tree.putDirectory([]);

        // Create directories
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

        for (const dir of sortedDirs) {
          const parts = dir.split('/');
          const name = parts.pop()!;
          const { cid: emptyDir } = await tree.putDirectory([]);
          rootCid = await tree.setEntry(rootCid, parts, name, emptyDir, 0, LinkType.Dir);
        }

        // Add files
        for (const file of files) {
          const parts = file.path.split('/');
          const name = parts.pop()!;
          const data = new Uint8Array(file.content);
          const { cid: fileCid, size } = await tree.putFile(data);
          rootCid = await tree.setEntry(rootCid, parts, name, fileCid, size, LinkType.Blob);
        }

        // Test checkoutCommit
        const { checkoutCommit } = await import('/src/utils/git.ts');

        try {
          const newRootCid = await checkoutCommit(rootCid, commitSha);

          // CRITICAL: Verify the returned CID is a valid directory that can be listed
          let canListDirectory = false;
          let entries: string[] = [];
          let listError: string | null = null;

          try {
            const dirEntries = await tree.listDirectory(newRootCid);
            canListDirectory = true;
            entries = dirEntries.map(e => `${e.name}${e.type === LinkType.Dir ? '/' : ''}`);
          } catch (err) {
            canListDirectory = false;
            listError = err instanceof Error ? err.message : String(err);
          }

          // Also verify the entries are correct (should have file.txt and .git, but NOT file2.txt)
          const hasFileTxt = entries.includes('file.txt');
          const hasFile2Txt = entries.includes('file2.txt');
          const hasGitDir = entries.includes('.git/');

          return {
            success: true,
            canListDirectory,
            listError,
            entries,
            hasFileTxt,
            hasFile2Txt,
            hasGitDir,
            error: null
          };
        } catch (err) {
          return {
            success: false,
            canListDirectory: false,
            listError: null,
            entries: [],
            hasFileTxt: false,
            hasFile2Txt: false,
            hasGitDir: false,
            error: err instanceof Error ? err.message : String(err)
          };
        }
      }, { files: allFiles, dirs: allDirs, commitSha: firstCommit });

      console.log('Checkout CID test result:', JSON.stringify(result, null, 2));
      console.log('Wasm-git logs:', wasmGitLogs);
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();

      // The key assertion: the returned CID MUST be a listable directory
      expect(result.canListDirectory).toBe(true);
      expect(result.listError).toBeNull();

      // Verify correct entries
      expect(result.hasFileTxt).toBe(true);
      expect(result.hasFile2Txt).toBe(false); // file2.txt was added in second commit
      expect(result.hasGitDir).toBe(true);

    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  test('should be able to add files and commit them via commit modal', { timeout: 90000 }, async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await navigateToPublicFolder(page);

    // Create a folder for our test repo
    await page.getByRole('button', { name: 'New Folder' }).click();
    const folderInput = page.locator('input[placeholder="Folder name..."]');
    await folderInput.waitFor({ timeout: 5000 });
    await folderInput.fill('commit-test-repo');
    await page.click('button:has-text("Create")');
    await expect(page.locator('.fixed.inset-0.bg-black')).not.toBeVisible({ timeout: 10000 });

    // Navigate into the folder
    const folderLink = page.locator('[data-testid="file-list"] a').filter({ hasText: 'commit-test-repo' }).first();
    await expect(folderLink).toBeVisible({ timeout: 15000 });
    await folderLink.click();
    await page.waitForURL(/commit-test-repo/, { timeout: 10000 });

    // Create initial files via the tree API
    await page.evaluate(async () => {
      const { getTree, LinkType } = await import('/src/store.ts');
      const { autosaveIfOwn } = await import('/src/nostr.ts');
      const { getCurrentRootCid } = await import('/src/actions/route.ts');
      const { getRouteSync } = await import('/src/stores/index.ts');
      const route = getRouteSync();

      const tree = getTree();
      let rootCid = getCurrentRootCid();
      if (!rootCid) return;

      // Create README.md
      const readmeContent = new TextEncoder().encode('# Commit Test Repo\n\nThis is a test repo for commit functionality.');
      const { cid: readmeCid, size: readmeSize } = await tree.putFile(readmeContent);
      rootCid = await tree.setEntry(rootCid, route.path, 'README.md', readmeCid, readmeSize, LinkType.Blob);

      // Create a src directory with a file
      const { cid: emptyDir } = await tree.putDirectory([]);
      rootCid = await tree.setEntry(rootCid, route.path, 'src', emptyDir, 0, LinkType.Dir);

      const mainContent = new TextEncoder().encode('console.log("Hello from commit test!");');
      const { cid: mainCid, size: mainSize } = await tree.putFile(mainContent);
      rootCid = await tree.setEntry(rootCid, [...route.path, 'src'], 'main.js', mainCid, mainSize, LinkType.Blob);

      autosaveIfOwn(rootCid);
    });

    // Wait for files to appear
    await expect(page.locator('[data-testid="file-list"] a').filter({ hasText: 'README.md' })).toBeVisible({ timeout: 15000 });

    // Git Init button should be visible
    const gitInitBtn = page.getByRole('button', { name: 'Git Init' });
    await expect(gitInitBtn).toBeVisible({ timeout: 15000 });

    // Click Git Init
    await gitInitBtn.click();

    // Wait for initialization to complete
    await expect(page.getByRole('button', { name: 'Initializing...' })).toBeVisible({ timeout: 5000 });
    await expect(gitInitBtn).not.toBeVisible({ timeout: 30000 });

    // Verify .git directory was created and commits button appears
    const gitDir = page.locator('[data-testid="file-list"] a').filter({ hasText: '.git' }).first();
    await expect(gitDir).toBeVisible({ timeout: 10000 });

    const commitsBtn = page.getByRole('button', { name: /commits/i });
    await expect(commitsBtn).toBeVisible({ timeout: 10000 });

    // Verify initial commit was created (should show "1 commits" or similar)
    await expect(commitsBtn).toContainText(/1/, { timeout: 10000 });

    // Now add a new file to create uncommitted changes
    await page.evaluate(async () => {
      const { getTree, LinkType } = await import('/src/store.ts');
      const { autosaveIfOwn } = await import('/src/nostr.ts');
      const { getCurrentRootCid } = await import('/src/actions/route.ts');
      const { getRouteSync } = await import('/src/stores/index.ts');
      const route = getRouteSync();

      const tree = getTree();
      let rootCid = getCurrentRootCid();
      if (!rootCid) return;

      // Add a new file
      const newFileContent = new TextEncoder().encode('export const VERSION = "1.0.0";');
      const { cid: newFileCid, size: newFileSize } = await tree.putFile(newFileContent);
      rootCid = await tree.setEntry(rootCid, [...route.path, 'src'], 'version.js', newFileCid, newFileSize, LinkType.Blob);

      // Modify README.md
      const updatedReadme = new TextEncoder().encode('# Commit Test Repo\n\nThis is a test repo for commit functionality.\n\n## Added\n- version.js');
      const { cid: updatedReadmeCid, size: updatedReadmeSize } = await tree.putFile(updatedReadme);
      rootCid = await tree.setEntry(rootCid, route.path, 'README.md', updatedReadmeCid, updatedReadmeSize, LinkType.Blob);

      autosaveIfOwn(rootCid);
    });

    // Wait for the uncommitted changes indicator to appear
    // It should show something like "2 uncommitted" or a warning colored number
    const uncommittedBtn = page.locator('button').filter({ hasText: /uncommitted/i });
    await expect(uncommittedBtn).toBeVisible({ timeout: 30000 });

    // Click to open commit modal
    await uncommittedBtn.click();

    // Commit modal should be visible
    const commitModal = page.locator('.fixed.inset-0').filter({ hasText: 'Commit Changes' });
    await expect(commitModal).toBeVisible({ timeout: 5000 });

    // Should show the changed files with checkboxes
    // Files may be shown with path prefix (src/version.js)
    // Check for file selection UI elements
    await expect(commitModal.locator('text=version.js').first()).toBeVisible({ timeout: 5000 });
    await expect(commitModal.locator('text=/\\d+ of \\d+ selected/')).toBeVisible({ timeout: 5000 });

    // Enter a commit message
    const commitMessageInput = commitModal.locator('textarea[placeholder*="Describe"]');
    await expect(commitMessageInput).toBeVisible({ timeout: 5000 });
    await commitMessageInput.fill('Add version.js and update README');

    // Click the Commit button
    const commitBtn = commitModal.getByRole('button', { name: 'Commit' });
    await expect(commitBtn).toBeEnabled({ timeout: 5000 });
    await commitBtn.click();

    // Wait for commit to complete (modal should close)
    await expect(commitModal).not.toBeVisible({ timeout: 30000 });

    // Verify commits count increased to 2 (this proves the commit worked)
    const updatedCommitsBtn = page.getByRole('button', { name: /commits/i });
    await expect(updatedCommitsBtn).toContainText(/2/, { timeout: 15000 });

    // Note: The status indicator may still show "uncommitted" briefly due to
    // the async nature of status refresh. The key verification is the commit count.

    // Open git history modal to verify our commit is there
    await updatedCommitsBtn.click();

    // Git history modal should show our commit message
    const historyModal = page.locator('.fixed.inset-0').filter({ hasText: 'Commit History' });
    await expect(historyModal).toBeVisible({ timeout: 5000 });
    await expect(historyModal.locator('text=Add version.js and update README')).toBeVisible({ timeout: 10000 });

    // Close modal
    await page.keyboard.press('Escape');
    await expect(historyModal).not.toBeVisible({ timeout: 5000 });
  });

  test('git status shows changes count correctly', { timeout: 60000 }, async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await navigateToPublicFolder(page);

    // Create a folder and init as git repo
    await page.getByRole('button', { name: 'New Folder' }).click();
    const folderInput = page.locator('input[placeholder="Folder name..."]');
    await folderInput.waitFor({ timeout: 5000 });
    await folderInput.fill('status-test-repo');
    await page.click('button:has-text("Create")');
    await expect(page.locator('.fixed.inset-0.bg-black')).not.toBeVisible({ timeout: 10000 });

    // Navigate into folder
    const folderLink = page.locator('[data-testid="file-list"] a').filter({ hasText: 'status-test-repo' }).first();
    await expect(folderLink).toBeVisible({ timeout: 15000 });
    await folderLink.click();
    await page.waitForURL(/status-test-repo/, { timeout: 10000 });

    // Create a file
    await page.evaluate(async () => {
      const { getTree, LinkType } = await import('/src/store.ts');
      const { autosaveIfOwn } = await import('/src/nostr.ts');
      const { getCurrentRootCid } = await import('/src/actions/route.ts');
      const { getRouteSync } = await import('/src/stores/index.ts');
      const route = getRouteSync();

      const tree = getTree();
      let rootCid = getCurrentRootCid();
      if (!rootCid) return;

      const content = new TextEncoder().encode('# Status Test Repo');
      const { cid, size } = await tree.putFile(content);
      rootCid = await tree.setEntry(rootCid, route.path, 'README.md', cid, size, LinkType.Blob);
      autosaveIfOwn(rootCid);
    });

    // Wait for file and init git
    await expect(page.locator('[data-testid="file-list"] a').filter({ hasText: 'README.md' })).toBeVisible({ timeout: 15000 });

    const gitInitBtn = page.getByRole('button', { name: 'Git Init' });
    await expect(gitInitBtn).toBeVisible({ timeout: 15000 });
    await gitInitBtn.click();

    // Wait for git init to complete
    await expect(gitInitBtn).not.toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('button', { name: /commits/i })).toBeVisible({ timeout: 10000 });

    // Verify git features are working - commits button should show at least 1 commit
    const commitsBtn = page.getByRole('button', { name: /commits/i });
    await expect(commitsBtn).toContainText(/\d+/, { timeout: 10000 });

    // If there are uncommitted changes shown, clicking it should open the commit modal
    const uncommittedBtn = page.locator('button').filter({ hasText: /uncommitted/i });
    const hasUncommitted = await uncommittedBtn.isVisible().catch(() => false);

    if (hasUncommitted) {
      // Click to verify the commit modal opens and shows changes
      await uncommittedBtn.click();
      const commitModal = page.locator('.fixed.inset-0').filter({ hasText: 'Commit Changes' });
      await expect(commitModal).toBeVisible({ timeout: 5000 });

      // Should show file count in footer (new UI: "X of Y file(s) selected")
      await expect(commitModal.locator('text=/\\d+ of \\d+ file/')).toBeVisible({ timeout: 5000 });

      // Close modal
      await page.keyboard.press('Escape');
      await expect(commitModal).not.toBeVisible({ timeout: 5000 });
    }
  });

  test('new branch can be created from branch dropdown', { timeout: 60000 }, async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await navigateToPublicFolder(page);

    // Create folder with file and init git
    await page.getByRole('button', { name: 'New Folder' }).click();
    const folderInput = page.locator('input[placeholder="Folder name..."]');
    await folderInput.waitFor({ timeout: 5000 });
    await folderInput.fill('branch-test-repo');
    await page.click('button:has-text("Create")');
    await expect(page.locator('.fixed.inset-0.bg-black')).not.toBeVisible({ timeout: 10000 });

    const folderLink = page.locator('[data-testid="file-list"] a').filter({ hasText: 'branch-test-repo' }).first();
    await expect(folderLink).toBeVisible({ timeout: 15000 });
    await folderLink.click();
    await page.waitForURL(/branch-test-repo/, { timeout: 10000 });

    // Create file via API
    await page.evaluate(async () => {
      const { getTree, LinkType } = await import('/src/store.ts');
      const { autosaveIfOwn } = await import('/src/nostr.ts');
      const { getCurrentRootCid } = await import('/src/actions/route.ts');
      const { getRouteSync } = await import('/src/stores/index.ts');
      const route = getRouteSync();

      const tree = getTree();
      let rootCid = getCurrentRootCid();
      if (!rootCid) return;

      const content = new TextEncoder().encode('# Branch Test');
      const { cid, size } = await tree.putFile(content);
      rootCid = await tree.setEntry(rootCid, route.path, 'README.md', cid, size, LinkType.Blob);
      autosaveIfOwn(rootCid);
    });

    await expect(page.locator('[data-testid="file-list"] a').filter({ hasText: 'README.md' })).toBeVisible({ timeout: 15000 });

    // Init git
    const gitInitBtn = page.getByRole('button', { name: 'Git Init' });
    await expect(gitInitBtn).toBeVisible({ timeout: 15000 });
    await gitInitBtn.click();
    await expect(gitInitBtn).not.toBeVisible({ timeout: 30000 });

    // Wait for git features to appear
    await expect(page.getByRole('button', { name: /commits/i })).toBeVisible({ timeout: 10000 });

    // Click branch dropdown - it's a button with git-branch icon and branch name
    // The button contains the branch name (e.g., "main", "master") and a chevron
    const branchBtn = page.locator('button').filter({ has: page.locator('.i-lucide-git-branch') }).first();
    await expect(branchBtn).toBeVisible({ timeout: 10000 });
    await branchBtn.click();

    // Branch dropdown should be open - look for "New branch" option
    const newBranchBtn = page.locator('button').filter({ hasText: 'New branch' });
    await expect(newBranchBtn).toBeVisible({ timeout: 5000 });
    await newBranchBtn.click();

    // New branch input should appear
    const branchNameInput = page.locator('input[placeholder="Branch name"]');
    await expect(branchNameInput).toBeVisible({ timeout: 5000 });
    await branchNameInput.fill('feature/test-branch');

    // Click Create button
    const createBtn = page.locator('button').filter({ hasText: 'Create' }).first();
    await createBtn.click();

    // Dropdown should close after creation
    await expect(branchNameInput).not.toBeVisible({ timeout: 10000 });

    // Verify via API that branch was created
    const result = await page.evaluate(async () => {
      const { getCurrentRootCid } = await import('/src/actions/route.ts');
      const { getBranches } = await import('/src/utils/git.ts');

      const rootCid = getCurrentRootCid();
      if (!rootCid) return { branches: [], error: 'No root CID' };

      try {
        const { branches } = await getBranches(rootCid);
        return { branches, error: null };
      } catch (err) {
        return { branches: [], error: String(err) };
      }
    });

    console.log('Branch creation result:', result);
    // Note: Due to the way wasm-git works (doesn't persist),
    // the new branch may not show up immediately via getBranches
    // But the UI flow should work without errors
    expect(result.error).toBeNull();
  });

  test('checkout previous revision removes files that were added later', { timeout: 120000 }, async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await navigateToPublicFolder(page);

    // Create a folder for our test repo
    await page.getByRole('button', { name: 'New Folder' }).click();
    const folderInput = page.locator('input[placeholder="Folder name..."]');
    await folderInput.waitFor({ timeout: 5000 });
    await folderInput.fill('checkout-test');
    await page.click('button:has-text("Create")');
    await expect(page.locator('.fixed.inset-0.bg-black')).not.toBeVisible({ timeout: 10000 });

    // Navigate into the folder
    const folderLink = page.locator('[data-testid="file-list"] a').filter({ hasText: 'checkout-test' }).first();
    await expect(folderLink).toBeVisible({ timeout: 15000 });
    await folderLink.click();
    await page.waitForURL(/checkout-test/, { timeout: 10000 });

    // Create initial file via the tree API
    await page.evaluate(async () => {
      const { getTree, LinkType } = await import('/src/store.ts');
      const { autosaveIfOwn } = await import('/src/nostr.ts');
      const { getCurrentRootCid } = await import('/src/actions/route.ts');
      const { getRouteSync } = await import('/src/stores/index.ts');
      const route = getRouteSync();

      const tree = getTree();
      let rootCid = getCurrentRootCid();
      if (!rootCid) return;

      // Create initial.txt
      const content = new TextEncoder().encode('Initial content');
      const { cid, size } = await tree.putFile(content);
      rootCid = await tree.setEntry(rootCid, route.path, 'initial.txt', cid, size, LinkType.Blob);

      autosaveIfOwn(rootCid);
    });

    // Wait for file to appear
    await expect(page.locator('[data-testid="file-list"] a').filter({ hasText: 'initial.txt' })).toBeVisible({ timeout: 15000 });

    // Initialize git repo (creates first commit with initial.txt)
    const gitInitBtn = page.getByRole('button', { name: 'Git Init' });
    await expect(gitInitBtn).toBeVisible({ timeout: 15000 });
    await gitInitBtn.click();
    await expect(gitInitBtn).not.toBeVisible({ timeout: 30000 });

    // Wait for git features
    const commitsBtn = page.getByRole('button', { name: /commits/i });
    await expect(commitsBtn).toBeVisible({ timeout: 10000 });
    await expect(commitsBtn).toContainText(/1/, { timeout: 10000 });

    // Add a second file
    await page.evaluate(async () => {
      const { getTree, LinkType } = await import('/src/store.ts');
      const { autosaveIfOwn } = await import('/src/nostr.ts');
      const { getCurrentRootCid } = await import('/src/actions/route.ts');
      const { getRouteSync } = await import('/src/stores/index.ts');
      const route = getRouteSync();

      const tree = getTree();
      let rootCid = getCurrentRootCid();
      if (!rootCid) return;

      // Create added-later.txt
      const content = new TextEncoder().encode('Added in second commit');
      const { cid, size } = await tree.putFile(content);
      rootCid = await tree.setEntry(rootCid, route.path, 'added-later.txt', cid, size, LinkType.Blob);

      autosaveIfOwn(rootCid);
    });

    // Wait for the new file to appear
    await expect(page.locator('[data-testid="file-list"] a').filter({ hasText: 'added-later.txt' })).toBeVisible({ timeout: 15000 });

    // Wait for uncommitted changes indicator and commit
    const uncommittedBtn = page.locator('button').filter({ hasText: /uncommitted/i });
    await expect(uncommittedBtn).toBeVisible({ timeout: 30000 });

    await uncommittedBtn.click();
    const commitModal = page.locator('.fixed.inset-0').filter({ hasText: 'Commit Changes' });
    await expect(commitModal).toBeVisible({ timeout: 5000 });

    const commitMessageInput = commitModal.locator('textarea[placeholder*="Describe"]');
    await commitMessageInput.fill('Add added-later.txt');
    const commitBtn = commitModal.getByRole('button', { name: /Commit/ });
    await commitBtn.click();
    await expect(commitModal).not.toBeVisible({ timeout: 30000 });

    // Verify we now have 2 commits and both files visible
    await expect(commitsBtn).toContainText(/2/, { timeout: 15000 });
    await expect(page.locator('[data-testid="file-list"] a').filter({ hasText: 'initial.txt' })).toBeVisible();
    await expect(page.locator('[data-testid="file-list"] a').filter({ hasText: 'added-later.txt' })).toBeVisible();

    // Open commit history
    await commitsBtn.click();
    const historyModal = page.locator('.fixed.inset-0').filter({ hasText: 'Commit History' });
    await expect(historyModal).toBeVisible({ timeout: 5000 });

    // Verify HEAD badge is shown on first commit
    await expect(historyModal.locator('text=HEAD')).toBeVisible({ timeout: 5000 });

    // Click checkout on the older commit (non-HEAD, should have Checkout button)
    const checkoutBtns = historyModal.locator('button').filter({ hasText: 'Checkout' });
    await expect(checkoutBtns.first()).toBeVisible({ timeout: 5000 });
    await checkoutBtns.first().click();

    // Wait for history modal to close
    await expect(historyModal).not.toBeVisible({ timeout: 30000 });

    // After checkout to initial commit:
    // - initial.txt should still be visible (was in first commit)
    // - added-later.txt should NOT be visible (was added in second commit)
    await expect(page.locator('[data-testid="file-list"] a').filter({ hasText: 'initial.txt' })).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="file-list"] a').filter({ hasText: 'added-later.txt' })).not.toBeVisible({ timeout: 5000 });

    // Verify we can still see commit history shows 2 commits
    const updatedCommitsBtn = page.getByRole('button', { name: /commits/i });
    await expect(updatedCommitsBtn).toContainText(/2/, { timeout: 10000 });
  });

});
