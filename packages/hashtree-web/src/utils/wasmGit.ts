/**
 * wasm-git wrapper for git operations
 * Uses libgit2 compiled to WebAssembly
 */
import type { CID } from 'hashtree';
import { LinkType } from 'hashtree';
import { getTree } from '../store';

// Module type from wasm-git
interface WasmGitModule {
  FS: {
    mkdir(path: string): void;
    writeFile(path: string, data: Uint8Array | string): void;
    readdir(path: string): string[];
    stat(path: string): { mode: number };
    readFile(path: string, opts?: { encoding?: string }): Uint8Array | string;
    chdir(path: string): void;
    cwd(): string;
    filesystems: { MEMFS: unknown };
    mount(fs: unknown, opts: unknown, path: string): void;
    unmount(path: string): void;
  };
  callMain(args: string[]): void;
  callWithOutput(args: string[]): string;
}

let wasmGitModule: WasmGitModule | null = null;
let moduleLoadPromise: Promise<WasmGitModule> | null = null;

// Mutex for serializing access to wasm-git module (single-threaded wasm can't handle concurrent ops)
let wasmGitLock: Promise<void> = Promise.resolve();

async function withWasmGitLock<T>(fn: () => Promise<T>): Promise<T> {
  // Wait for any previous operation to complete
  const prevLock = wasmGitLock;
  let resolveLock: () => void;
  wasmGitLock = new Promise(resolve => { resolveLock = resolve; });
  await prevLock;
  try {
    return await fn();
  } finally {
    resolveLock!();
  }
}

/**
 * Load the wasm-git module (lazy, singleton)
 */
async function loadWasmGit(): Promise<WasmGitModule> {
  if (wasmGitModule) return wasmGitModule;
  if (moduleLoadPromise) return moduleLoadPromise;

  moduleLoadPromise = (async () => {
    // Configure wasm-git to load wasm from public directory
    (globalThis as Record<string, unknown>).wasmGitModuleOverrides = {
      locateFile: (path: string) => {
        // Return path to wasm file in public directory
        if (path.endsWith('.wasm')) {
          return '/lg2_async.wasm';
        }
        return path;
      },
    };

    // Import from node_modules (Vite will handle bundling the JS)
    // The wasm file is served from public directory
    const { default: createModule } = await import('wasm-git');
    wasmGitModule = await createModule();
    return wasmGitModule!;
  })();

  return moduleLoadPromise;
}

/**
 * Copy hashtree directory contents to wasm-git filesystem
 */
async function copyToWasmFS(
  module: WasmGitModule,
  cid: CID,
  destPath: string
): Promise<void> {
  const tree = getTree();
  const entries = await tree.listDirectory(cid);

  for (const entry of entries) {
    const entryPath = `${destPath}/${entry.name}`;

    if (entry.type === LinkType.Dir) {
      try {
        module.FS.mkdir(entryPath);
      } catch {
        // Directory may already exist
      }
      await copyToWasmFS(module, entry.cid, entryPath);
    } else {
      const data = await tree.readFile(entry.cid);
      if (data) {
        module.FS.writeFile(entryPath, data);
      }
    }
  }
}

/**
 * Get commit log using wasm-git
 */
export async function getLogWithWasmGit(
  rootCid: CID,
  options?: { depth?: number }
): Promise<Array<{
  oid: string;
  message: string;
  author: string;
  email: string;
  timestamp: number;
  parent: string[];
}>> {
  return withWasmGitLock(async () => {
    const tree = getTree();
    const depth = options?.depth ?? 20;

    // Check for .git directory
    const gitDirResult = await tree.resolvePath(rootCid, '.git');
    if (!gitDirResult || gitDirResult.type !== LinkType.Dir) {
      console.log('[wasm-git] No .git directory found');
      return [];
    }

    const module = await loadWasmGit();

    // Use a unique path for each call to avoid conflicts
    const repoPath = `/repo_${Date.now()}`;
    const originalCwd = module.FS.cwd();

    try {
    // Create and mount a fresh working directory
    module.FS.mkdir(repoPath);

    // Write .gitconfig so git doesn't complain about missing user
    try {
      module.FS.writeFile('/home/web_user/.gitconfig', '[user]\nname = Reader\nemail = reader@example.com\n');
    } catch {
      // May already exist
    }

    // Change to repo directory
    module.FS.chdir(repoPath);

    // Initialize a git repo first so it has proper structure
    try {
      module.callMain(['init', '.']);
    } catch {
      // Ignore init errors
    }

    // Copy .git contents from hashtree to wasm filesystem
    // This overwrites the initialized .git with our actual git data
    await copyToWasmFS(module, gitDirResult.cid, '.git');

    // Run git log (wasm-git only supports basic format without options)
    const output = module.callWithOutput(['log']);

    if (!output || output.trim() === '') {
      return [];
    }

    // Parse the default git log format:
    // commit <sha>
    // Author: <name> <email>
    // Date:   <date>
    //
    //     <message>
    //
    const commits: Array<{
      oid: string;
      message: string;
      author: string;
      email: string;
      timestamp: number;
      parent: string[];
    }> = [];

    const commitBlocks = output.split(/^commit /m).filter(Boolean);

    for (const block of commitBlocks) {
      if (commits.length >= depth) break;

      const lines = block.split('\n');
      const oid = lines[0]?.trim();
      if (!oid || oid.length !== 40) continue;

      let author = '';
      let email = '';
      let timestamp = 0;
      const messageLines: string[] = [];
      let inMessage = false;

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];

        if (line.startsWith('Author: ')) {
          const authorMatch = line.match(/^Author:\s*(.+?)\s*<(.+?)>/);
          if (authorMatch) {
            author = authorMatch[1].trim();
            email = authorMatch[2];
          }
        } else if (line.startsWith('Date: ')) {
          // Parse date like "Thu Dec 11 15:05:31 2025 +0000"
          const dateStr = line.substring(6).trim();
          const date = new Date(dateStr);
          if (!isNaN(date.getTime())) {
            timestamp = Math.floor(date.getTime() / 1000);
          }
        } else if (line === '') {
          if (author && !inMessage) {
            inMessage = true;
          }
        } else if (inMessage) {
          // Message lines are indented with 4 spaces
          messageLines.push(line.replace(/^    /, ''));
        }
      }

      const message = messageLines.join('\n').trim();

      commits.push({
        oid,
        message,
        author,
        email,
        timestamp,
        parent: [], // wasm-git default format doesn't include parent info
      });
    }

    return commits;
  } catch (err) {
    console.error('[wasm-git] git log failed:', err);
    return [];
  } finally {
    // Restore original working directory
    try {
      module.FS.chdir(originalCwd);
    } catch {
      // Ignore errors
    }
  }
  });
}

/**
 * Get list of branches using wasm-git
 */
export async function getBranchesWithWasmGit(
  rootCid: CID
): Promise<{ branches: string[]; currentBranch: string | null }> {
  return withWasmGitLock(async () => {
    const tree = getTree();

    // Check for .git directory
    const gitDirResult = await tree.resolvePath(rootCid, '.git');
    if (!gitDirResult || gitDirResult.type !== LinkType.Dir) {
      return { branches: [], currentBranch: null };
    }

    const module = await loadWasmGit();
    const repoPath = `/repo_${Date.now()}`;
    const originalCwd = module.FS.cwd();

    try {
      module.FS.mkdir(repoPath);

      try {
        module.FS.writeFile('/home/web_user/.gitconfig', '[user]\nname = Reader\nemail = reader@example.com\n');
      } catch {
        // May already exist
      }

      module.FS.chdir(repoPath);

      try {
        module.callMain(['init', '.']);
      } catch {
        // Ignore init errors
      }

      await copyToWasmFS(module, gitDirResult.cid, '.git');

      // Get current branch from status
      let currentBranch: string | null = null;
      try {
        const statusOutput = module.callWithOutput(['status']);
        const branchMatch = statusOutput.match(/On branch (\S+)/);
        if (branchMatch) {
          currentBranch = branchMatch[1];
        }
      } catch {
        // Ignore
      }

      // Get list of branches using for-each-ref
      const branches: string[] = [];
      try {
        const refsOutput = module.callWithOutput(['for-each-ref', '--format=%(refname:short)', 'refs/heads/']);
        if (refsOutput) {
          const lines = refsOutput.trim().split('\n');
          for (const line of lines) {
            const branch = line.trim();
            if (branch) {
              branches.push(branch);
            }
          }
        }
      } catch {
        // Ignore - may not have any branches
      }

      return { branches, currentBranch };
    } catch (err) {
      console.error('[wasm-git] getBranches failed:', err);
      return { branches: [], currentBranch: null };
    } finally {
      try {
        module.FS.chdir(originalCwd);
      } catch {
        // Ignore
      }
    }
  });
}

/**
 * Get last commit info for files in a directory
 * Returns a map of filename -> commit info
 */
export async function getFileLastCommitsWithWasmGit(
  rootCid: CID,
  filenames: string[]
): Promise<Map<string, { oid: string; message: string; timestamp: number }>> {
  return withWasmGitLock(async () => {
    const tree = getTree();
    const result = new Map<string, { oid: string; message: string; timestamp: number }>();

    if (filenames.length === 0) return result;

    // Check for .git directory
    const gitDirResult = await tree.resolvePath(rootCid, '.git');
    if (!gitDirResult || gitDirResult.type !== LinkType.Dir) {
      return result;
    }

    const module = await loadWasmGit();
    const repoPath = `/repo_${Date.now()}`;
    const originalCwd = module.FS.cwd();

    try {
      module.FS.mkdir(repoPath);

      try {
        module.FS.writeFile('/home/web_user/.gitconfig', '[user]\nname = Reader\nemail = reader@example.com\n');
      } catch {
        // May already exist
      }

      module.FS.chdir(repoPath);

      try {
        module.callMain(['init', '.']);
      } catch {
        // Ignore init errors
      }

      await copyToWasmFS(module, gitDirResult.cid, '.git');

      // For each file, get the last commit that touched it
      for (const filename of filenames) {
        // Skip .git directory
        if (filename === '.git') continue;

        try {
          // Run git log -1 -- <filename> to get last commit for this file
          const output = module.callWithOutput(['log', '-1', '--', filename]);

          if (!output || output.trim() === '') continue;

          // Parse same format as getLogWithWasmGit
          const lines = output.split('\n');
          let oid = '';
          let timestamp = 0;
          const messageLines: string[] = [];
          let inMessage = false;

          for (const line of lines) {
            if (line.startsWith('commit ')) {
              oid = line.substring(7).trim();
            } else if (line.startsWith('Date: ')) {
              const dateStr = line.substring(6).trim();
              const date = new Date(dateStr);
              if (!isNaN(date.getTime())) {
                timestamp = Math.floor(date.getTime() / 1000);
              }
            } else if (line === '') {
              if (oid && !inMessage) {
                inMessage = true;
              }
            } else if (inMessage) {
              messageLines.push(line.replace(/^    /, ''));
            }
          }

          if (oid) {
            result.set(filename, {
              oid,
              message: messageLines.join('\n').trim(),
              timestamp,
            });
          }
        } catch {
          // Skip files with errors
        }
      }

      return result;
    } catch (err) {
      console.error('[wasm-git] getFileLastCommits failed:', err);
      return result;
    } finally {
      try {
        module.FS.chdir(originalCwd);
      } catch {
        // Ignore
      }
    }
  });
}

/**
 * Initialize a git repository in a directory
 * Copies files to wasm-git, runs git init + add + commit, returns .git directory files
 */
export async function initGitRepoWithWasmGit(
  rootCid: CID,
  authorName: string,
  authorEmail: string,
  commitMessage: string = 'Initial commit'
): Promise<Array<{ name: string; data: Uint8Array; isDir: boolean }>> {
  return withWasmGitLock(async () => {
    const tree = getTree();
    const module = await loadWasmGit();
    const repoPath = `/repo_${Date.now()}`;
    const originalCwd = module.FS.cwd();

    try {
      module.FS.mkdir(repoPath);

      // Set up git config with user info
      try {
        module.FS.writeFile('/home/web_user/.gitconfig', `[user]\nname = ${authorName}\nemail = ${authorEmail}\n`);
      } catch {
        // May already exist
      }

      module.FS.chdir(repoPath);

      // Copy all files from hashtree to wasm filesystem
      await copyToWasmFS(module, rootCid, '.');

      // Initialize git repo
      module.callMain(['init', '.']);

      // Add all files
      module.callMain(['add', '.']);

      // Create initial commit
      module.callMain(['commit', '-m', commitMessage]);

      // Read .git directory and return files
      const gitFiles: Array<{ name: string; data: Uint8Array; isDir: boolean }> = [];

      function readGitDir(path: string, prefix: string): void {
        const entries = module.FS.readdir(path);
        for (const entry of entries) {
          if (entry === '.' || entry === '..') continue;

          const fullPath = `${path}/${entry}`;
          const relativePath = prefix ? `${prefix}/${entry}` : entry;

          try {
            const stat = module.FS.stat(fullPath);
            const isDir = (stat.mode & 0o170000) === 0o040000;
            if (isDir) {
              gitFiles.push({ name: relativePath, data: new Uint8Array(0), isDir: true });
              readGitDir(fullPath, relativePath);
            } else {
              const data = module.FS.readFile(fullPath) as Uint8Array;
              gitFiles.push({ name: relativePath, data, isDir: false });
            }
          } catch {
            // Skip files we can't read
          }
        }
      }

      readGitDir('.git', '.git');

      return gitFiles;
    } catch (err) {
      console.error('[wasm-git] init failed:', err);
      throw err;
    } finally {
      try {
        module.FS.chdir(originalCwd);
      } catch {
        // Ignore
      }
    }
  });
}

/**
 * Git status entry from porcelain format
 */
export interface GitStatusEntry {
  /** Two-character status code (XY) */
  status: string;
  /** File path */
  path: string;
  /** Original path (for renames) */
  origPath?: string;
}

/**
 * Git status result
 */
export interface GitStatusResult {
  /** Staged files (to be committed) */
  staged: GitStatusEntry[];
  /** Modified but not staged */
  unstaged: GitStatusEntry[];
  /** Untracked files */
  untracked: GitStatusEntry[];
  /** Whether there are any changes */
  hasChanges: boolean;
}

/**
 * Get git status using wasm-git
 * Returns parsed status with staged, unstaged, and untracked files
 */
export async function getStatusWithWasmGit(
  rootCid: CID
): Promise<GitStatusResult> {
  const tree = getTree();

  // Check for .git directory
  const gitDirResult = await tree.resolvePath(rootCid, '.git');
  if (!gitDirResult || gitDirResult.type !== LinkType.Dir) {
    return { staged: [], unstaged: [], untracked: [], hasChanges: false };
  }

  const module = await loadWasmGit();
  const repoPath = `/repo_${Date.now()}`;
  const originalCwd = module.FS.cwd();

  try {
    module.FS.mkdir(repoPath);

    try {
      module.FS.writeFile('/home/web_user/.gitconfig', '[user]\nname = Reader\nemail = reader@example.com\n');
    } catch {
      // May already exist
    }

    module.FS.chdir(repoPath);

    try {
      module.callMain(['init', '.']);
    } catch {
      // Ignore init errors
    }

    // Copy entire repo (not just .git) so we can compare working tree
    await copyToWasmFS(module, rootCid, '.');

    // Run git status --porcelain
    let output = '';
    try {
      output = module.callWithOutput(['status', '--porcelain']);
    } catch {
      // Status may fail on fresh repos
      return { staged: [], unstaged: [], untracked: [], hasChanges: false };
    }

    if (!output || output.trim() === '') {
      return { staged: [], unstaged: [], untracked: [], hasChanges: false };
    }

    // Parse porcelain format:
    // XY PATH
    // X = index status, Y = working tree status
    // ?? = untracked, A = added, M = modified, D = deleted, R = renamed
    const staged: GitStatusEntry[] = [];
    const unstaged: GitStatusEntry[] = [];
    const untracked: GitStatusEntry[] = [];

    const lines = output.trim().split('\n');
    for (const line of lines) {
      if (line.length < 3) continue;

      const x = line[0]; // Index status
      const y = line[1]; // Working tree status
      const rest = line.slice(3);

      // Handle renames: "R  old -> new"
      let path = rest;
      let origPath: string | undefined;
      if (rest.includes(' -> ')) {
        const parts = rest.split(' -> ');
        origPath = parts[0];
        path = parts[1];
      }

      const status = x + y;

      if (status === '??') {
        untracked.push({ status, path });
      } else {
        // X indicates staged changes
        if (x !== ' ' && x !== '?') {
          staged.push({ status, path, origPath });
        }
        // Y indicates unstaged changes
        if (y !== ' ' && y !== '?') {
          unstaged.push({ status, path, origPath });
        }
      }
    }

    return {
      staged,
      unstaged,
      untracked,
      hasChanges: staged.length > 0 || unstaged.length > 0 || untracked.length > 0,
    };
  } catch (err) {
    console.error('[wasm-git] getStatus failed:', err);
    return { staged: [], unstaged: [], untracked: [], hasChanges: false };
  } finally {
    try {
      module.FS.chdir(originalCwd);
    } catch {
      // Ignore
    }
  }
}

/**
 * Create a new branch using wasm-git
 */
export async function createBranchWithWasmGit(
  rootCid: CID,
  branchName: string,
  checkout: boolean = true
): Promise<{ success: boolean; error?: string }> {
  const tree = getTree();

  // Check for .git directory
  const gitDirResult = await tree.resolvePath(rootCid, '.git');
  if (!gitDirResult || gitDirResult.type !== LinkType.Dir) {
    return { success: false, error: 'Not a git repository' };
  }

  const module = await loadWasmGit();
  const repoPath = `/repo_${Date.now()}`;
  const originalCwd = module.FS.cwd();

  try {
    module.FS.mkdir(repoPath);

    try {
      module.FS.writeFile('/home/web_user/.gitconfig', '[user]\nname = User\nemail = user@example.com\n');
    } catch {
      // May already exist
    }

    module.FS.chdir(repoPath);

    try {
      module.callMain(['init', '.']);
    } catch {
      // Ignore init errors
    }

    await copyToWasmFS(module, gitDirResult.cid, '.git');

    // Create the branch
    try {
      if (checkout) {
        module.callMain(['checkout', '-b', branchName]);
      } else {
        module.callMain(['branch', branchName]);
      }
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  } catch (err) {
    console.error('[wasm-git] createBranch failed:', err);
    return { success: false, error: 'Failed to create branch' };
  } finally {
    try {
      module.FS.chdir(originalCwd);
    } catch {
      // Ignore
    }
  }
}

/**
 * Stage files and create a commit using wasm-git
 * Returns the updated .git directory files to be saved back to hashtree
 */
export async function commitWithWasmGit(
  rootCid: CID,
  message: string,
  authorName: string,
  authorEmail: string,
  filesToStage?: string[] // If undefined, stages all changes
): Promise<{ success: boolean; gitFiles?: Array<{ name: string; data: Uint8Array; isDir: boolean }>; error?: string }> {
  const tree = getTree();

  // Check for .git directory
  const gitDirResult = await tree.resolvePath(rootCid, '.git');
  if (!gitDirResult || gitDirResult.type !== LinkType.Dir) {
    return { success: false, error: 'Not a git repository' };
  }

  const module = await loadWasmGit();
  const repoPath = `/repo_${Date.now()}`;
  const originalCwd = module.FS.cwd();

  try {
    module.FS.mkdir(repoPath);

    // Set up git config with user info
    try {
      module.FS.writeFile('/home/web_user/.gitconfig', `[user]\nname = ${authorName}\nemail = ${authorEmail}\n`);
    } catch {
      // May already exist
    }

    module.FS.chdir(repoPath);

    try {
      module.callMain(['init', '.']);
    } catch {
      // Ignore init errors
    }

    // Copy entire repo so we have working tree + .git
    await copyToWasmFS(module, rootCid, '.');

    // Stage files
    try {
      if (filesToStage && filesToStage.length > 0) {
        for (const file of filesToStage) {
          module.callMain(['add', file]);
        }
      } else {
        // Stage all changes
        module.callMain(['add', '-A']);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Failed to stage files: ${msg}` };
    }

    // Create commit
    try {
      module.callMain(['commit', '-m', message]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Failed to commit: ${msg}` };
    }

    // Read updated .git directory and return files
    const gitFiles: Array<{ name: string; data: Uint8Array; isDir: boolean }> = [];

    function readGitDir(path: string, prefix: string): void {
      const entries = module.FS.readdir(path);
      for (const entry of entries) {
        if (entry === '.' || entry === '..') continue;

        const fullPath = `${path}/${entry}`;
        const relativePath = prefix ? `${prefix}/${entry}` : entry;

        try {
          const stat = module.FS.stat(fullPath);
          const isDir = (stat.mode & 0o170000) === 0o040000;
          if (isDir) {
            gitFiles.push({ name: relativePath, data: new Uint8Array(0), isDir: true });
            readGitDir(fullPath, relativePath);
          } else {
            const data = module.FS.readFile(fullPath) as Uint8Array;
            gitFiles.push({ name: relativePath, data, isDir: false });
          }
        } catch {
          // Skip files we can't read
        }
      }
    }

    readGitDir('.git', '.git');

    return { success: true, gitFiles };
  } catch (err) {
    console.error('[wasm-git] commit failed:', err);
    return { success: false, error: 'Failed to commit' };
  } finally {
    try {
      module.FS.chdir(originalCwd);
    } catch {
      // Ignore
    }
  }
}

/**
 * Checkout a specific commit using wasm-git
 * Returns files from that commit as a directory listing
 */
export async function checkoutWithWasmGit(
  rootCid: CID,
  commitSha: string,
  onProgress?: (file: string) => void
): Promise<Array<{ name: string; data: Uint8Array; isDir: boolean }>> {
  return withWasmGitLock(async () => {
    const tree = getTree();

    // Check for .git directory
    const gitDirResult = await tree.resolvePath(rootCid, '.git');
    if (!gitDirResult || gitDirResult.type !== LinkType.Dir) {
      throw new Error('Not a git repository');
    }

    const module = await loadWasmGit();
    const repoPath = `/repo_${Date.now()}`;
    const originalCwd = module.FS.cwd();

    try {
      module.FS.mkdir(repoPath);

      try {
        module.FS.writeFile('/home/web_user/.gitconfig', '[user]\nname = Reader\nemail = reader@example.com\n');
      } catch {
        // May already exist
      }

      module.FS.chdir(repoPath);

      try {
        module.callMain(['init', '.']);
      } catch {
        // Ignore init errors
      }

      await copyToWasmFS(module, gitDirResult.cid, '.git');

      // Checkout the commit
      try {
        module.callMain(['checkout', '--force', commitSha]);
      } catch (err) {
        console.error('[wasm-git] checkout error:', err);
        throw new Error(`Failed to checkout ${commitSha}: ${err}`);
      }

      // Read all files from the working directory (excluding .git)
      const files: Array<{ name: string; data: Uint8Array; isDir: boolean }> = [];

      function readDir(path: string, prefix: string): void {
        const entries = module.FS.readdir(path);
        for (const entry of entries) {
          if (entry === '.' || entry === '..' || entry === '.git') continue;

          const fullPath = path === '.' ? entry : `${path}/${entry}`;
          const relativePath = prefix ? `${prefix}/${entry}` : entry;

          try {
            const stat = module.FS.stat(fullPath);
            // Emscripten's stat returns mode as number, check S_IFDIR (0o40000)
            const isDir = (stat.mode & 0o170000) === 0o040000;
            if (isDir) {
              files.push({ name: relativePath, data: new Uint8Array(0), isDir: true });
              readDir(fullPath, relativePath);
            } else {
              if (onProgress) onProgress(relativePath);
              const data = module.FS.readFile(fullPath) as Uint8Array;
              files.push({ name: relativePath, data, isDir: false });
            }
          } catch {
            // Skip files we can't read
          }
        }
      }

      readDir('.', '');

      return files;
    } catch (err) {
      console.error('[wasm-git] checkout failed:', err);
      throw err;
    } finally {
      try {
        module.FS.chdir(originalCwd);
      } catch {
        // Ignore
      }
    }
  });
}

/**
 * Run an arbitrary git command in the repository
 * Returns the command output and optionally the updated .git files for write commands
 */
export async function runGitCommand(
  rootCid: CID,
  command: string,
  options?: {
    /** Author name for commits */
    authorName?: string;
    /** Author email for commits */
    authorEmail?: string;
  }
): Promise<{ output: string; error?: string; gitFiles?: Array<{ name: string; data: Uint8Array; isDir: boolean }> }> {
  return withWasmGitLock(async () => {
    const tree = getTree();

    // Check for .git directory
    const gitDirResult = await tree.resolvePath(rootCid, '.git');
    if (!gitDirResult || gitDirResult.type !== LinkType.Dir) {
      return { output: '', error: 'Not a git repository' };
    }

    const module = await loadWasmGit();
    const repoPath = `/repo_${Date.now()}`;
    const originalCwd = module.FS.cwd();

    // Detect write commands that modify the repository
    const args = parseCommandArgs(command);
    const writeCommands = ['add', 'commit', 'reset', 'checkout', 'merge', 'rebase', 'cherry-pick', 'revert', 'tag', 'branch', 'rm', 'mv'];
    const isWriteCommand = args.length > 0 && writeCommands.includes(args[0]);

    try {
      module.FS.mkdir(repoPath);

      // Set up git config with user info
      const authorName = options?.authorName || 'User';
      const authorEmail = options?.authorEmail || 'user@example.com';
      try {
        module.FS.writeFile('/home/web_user/.gitconfig', `[user]\nname = ${authorName}\nemail = ${authorEmail}\n`);
      } catch {
        // May already exist
      }

      module.FS.chdir(repoPath);

      // Copy full working directory from hashtree (including .git)
      await copyToWasmFS(module, rootCid, '.');

      if (args.length === 0) {
        return { output: '', error: 'No command provided' };
      }

      // Run the git command
      let output = '';
      try {
        output = module.callWithOutput(args) || '';
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return { output: '', error: errorMsg };
      }

      // For write commands, read back the updated .git directory
      if (isWriteCommand) {
        const gitFiles: Array<{ name: string; data: Uint8Array; isDir: boolean }> = [];

        function readGitDir(path: string, prefix: string): void {
          const entries = module.FS.readdir(path);
          for (const entry of entries) {
            if (entry === '.' || entry === '..') continue;

            const fullPath = `${path}/${entry}`;
            const relativePath = prefix ? `${prefix}/${entry}` : entry;

            try {
              const stat = module.FS.stat(fullPath);
              const isDir = (stat.mode & 0o170000) === 0o040000;
              if (isDir) {
                gitFiles.push({ name: relativePath, data: new Uint8Array(0), isDir: true });
                readGitDir(fullPath, relativePath);
              } else {
                const data = module.FS.readFile(fullPath) as Uint8Array;
                gitFiles.push({ name: relativePath, data, isDir: false });
              }
            } catch {
              // Skip files we can't read
            }
          }
        }

        readGitDir('.git', '.git');
        return { output, gitFiles };
      }

      return { output };
    } catch (err) {
      console.error('[wasm-git] runGitCommand failed:', err);
      return { output: '', error: err instanceof Error ? err.message : String(err) };
    } finally {
      try {
        module.FS.chdir(originalCwd);
      } catch {
        // Ignore
      }
    }
  });
}

/**
 * Parse command string into args, handling quoted strings
 */
function parseCommandArgs(command: string): string[] {
  const args: string[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';

  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    if (inQuote) {
      if (char === quoteChar) {
        inQuote = false;
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      inQuote = true;
      quoteChar = char;
    } else if (char === ' ') {
      if (current) {
        args.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }

  if (current) {
    args.push(current);
  }

  return args;
}
