/**
 * Git utilities using wasm-git (libgit2 compiled to WebAssembly)
 */
import type { CID } from 'hashtree';
import { LinkType } from 'hashtree';
import { getTree } from '../store';

export interface CloneOptions {
  url: string;
  /** Optional branch/ref to checkout (default: default branch) */
  ref?: string;
  /** Shallow clone depth (default: full clone) */
  depth?: number;
  /** Progress callback */
  onProgress?: (phase: string, loaded: number, total: number) => void;
}

export interface CloneResult {
  /** Root CID of the cloned repository */
  rootCid: CID;
  /** Current branch/ref */
  ref: string;
}

/**
 * Clone a git repository into hashtree storage
 * Note: Clone functionality requires network access and CORS proxy
 */
export async function cloneRepo(_options: CloneOptions): Promise<CloneResult> {
  // Clone is complex with wasm-git - requires CORS proxy setup
  // For now, throw not implemented
  throw new Error('Clone not yet implemented with wasm-git. Upload a git repo folder instead.');
}

type CommitLog = Array<{
  oid: string;
  message: string;
  author: string;
  email: string;
  timestamp: number;
  parent: string[];
}>;

/**
 * Get commit log for a repository
 * Uses wasm-git (libgit2)
 */
export async function getLog(rootCid: CID, options?: { depth?: number }): Promise<CommitLog>;
export async function getLog(rootCid: CID, options: { depth?: number; debug: true }): Promise<{ commits: CommitLog; debug: string[] }>;
export async function getLog(rootCid: CID, options?: { depth?: number; debug?: boolean }): Promise<CommitLog | { commits: CommitLog; debug: string[] }> {
  const debugInfo: string[] = [];
  const depth = options?.depth ?? 20;

  try {
    const { getLogWithWasmGit } = await import('./wasmGit');
    debugInfo.push('Using wasm-git');
    const commits = await getLogWithWasmGit(rootCid, { depth });
    debugInfo.push(`Found ${commits.length} commits`);
    if (options?.debug) {
      return { commits, debug: debugInfo };
    }
    return commits;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    debugInfo.push(`wasm-git failed: ${message}`);
    if (options?.debug) {
      return { commits: [], debug: debugInfo };
    }
    return [];
  }
}

/**
 * Get list of branches
 * Uses wasm-git (libgit2)
 */
export async function getBranches(rootCid: CID) {
  try {
    const { getBranchesWithWasmGit } = await import('./wasmGit');
    return await getBranchesWithWasmGit(rootCid);
  } catch {
    return { branches: [], currentBranch: null };
  }
}

/**
 * Get current HEAD commit SHA
 * Uses wasm-git (libgit2)
 */
export async function getHead(rootCid: CID): Promise<string | null> {
  try {
    const { getHeadWithWasmGit } = await import('./wasmGit');
    return await getHeadWithWasmGit(rootCid);
  } catch {
    return null;
  }
}

/**
 * Get git status (staged, unstaged, untracked files)
 * Uses wasm-git (libgit2)
 */
export async function getStatus(rootCid: CID) {
  try {
    const { getStatusWithWasmGit } = await import('./wasmGit');
    return await getStatusWithWasmGit(rootCid);
  } catch {
    return { staged: [], unstaged: [], untracked: [], hasChanges: false };
  }
}

/**
 * Create a new branch
 * Uses wasm-git (libgit2)
 */
export async function createBranch(rootCid: CID, branchName: string, checkout: boolean = true) {
  const { createBranchWithWasmGit } = await import('./wasmGit');
  return await createBranchWithWasmGit(rootCid, branchName, checkout);
}

/**
 * Stage files and create a commit
 * Returns the updated .git directory files to be saved back to hashtree
 */
export async function commit(
  rootCid: CID,
  message: string,
  authorName: string,
  authorEmail: string,
  filesToStage?: string[]
) {
  const { commitWithWasmGit } = await import('./wasmGit');
  return await commitWithWasmGit(rootCid, message, authorName, authorEmail, filesToStage);
}

/**
 * Get diff between two commits
 * Note: Full diff implementation requires tree walking - not yet implemented
 */
export async function getDiff(_rootCid: CID, _commitHash1: string, _commitHash2?: string): Promise<string> {
  // TODO: Implement with wasm-git diff command
  return '';
}

/**
 * Check if a directory contains a .git folder (is a git repo)
 * This check is lightweight - doesn't load wasm-git
 */
export async function isGitRepo(rootCid: CID): Promise<boolean> {
  const tree = getTree();

  try {
    // Check for .git directory
    const gitDirResult = await tree.resolvePath(rootCid, '.git');
    if (!gitDirResult || gitDirResult.type !== LinkType.Dir) {
      return false;
    }

    // Check for HEAD file inside .git
    const headResult = await tree.resolvePath(gitDirResult.cid, 'HEAD');
    return headResult !== null && headResult.type !== LinkType.Dir;
  } catch {
    return false;
  }
}

/**
 * Get file content at a specific commit
 * Note: Requires tree walking from commit to find blob - not yet implemented
 */
export async function getFileAtCommit(
  _rootCid: CID,
  _filepath: string,
  _commitHash: string
): Promise<Uint8Array | null> {
  // TODO: Implement with wasm-git checkout and read
  return null;
}

/**
 * Get blame information for a file
 */
export async function getBlame(_rootCid: CID, _filepath: string) {
  // TODO: Implement with wasm-git blame command
  return null;
}

/**
 * Initialize a git repository in a directory
 * Returns files for the .git directory to be added to the tree
 */
export async function initGitRepo(
  rootCid: CID,
  authorName: string,
  authorEmail: string,
  commitMessage: string = 'Initial commit'
): Promise<Array<{ name: string; data: Uint8Array; isDir: boolean }>> {
  const { initGitRepoWithWasmGit } = await import('./wasmGit');
  return await initGitRepoWithWasmGit(rootCid, authorName, authorEmail, commitMessage);
}

/**
 * Get last commit info for files in a directory
 * Returns a map of filename -> commit info
 */
export async function getFileLastCommits(
  rootCid: CID,
  filenames: string[]
): Promise<Map<string, { oid: string; message: string; timestamp: number }>> {
  try {
    const { getFileLastCommitsWithWasmGit } = await import('./wasmGit');
    return await getFileLastCommitsWithWasmGit(rootCid, filenames);
  } catch {
    return new Map();
  }
}

/**
 * Checkout a specific commit - builds a new hashtree directory from the commit's tree
 * Returns the new root CID containing the files at that commit
 * Uses wasm-git (libgit2)
 */
export async function checkoutCommit(
  rootCid: CID,
  commitSha: string,
  onProgress?: (file: string) => void
): Promise<CID> {
  const tree = getTree();

  // Get the .git directory to verify this is a git repo
  const gitDirResult = await tree.resolvePath(rootCid, '.git');
  if (!gitDirResult || gitDirResult.type !== LinkType.Dir) {
    throw new Error('Not a git repository');
  }

  // Use wasm-git to checkout and get files + updated .git
  const { checkoutWithWasmGit } = await import('./wasmGit');
  const { files, gitFiles } = await checkoutWithWasmGit(rootCid, commitSha, onProgress);

  // Build hashtree entries from checkout result
  // First, organize files into a tree structure
  const dirMap = new Map<string, Array<{ name: string; cid: CID; size: number; type: LinkType }>>();
  dirMap.set('', []); // Root directory

  // Process directories first
  for (const file of files) {
    if (file.isDir) {
      dirMap.set(file.name, []);
    }
  }

  // Process files and build from leaves up
  for (const file of files) {
    if (!file.isDir) {
      const { cid, size } = await tree.putFile(file.data);
      const parentDir = file.name.includes('/') ? file.name.substring(0, file.name.lastIndexOf('/')) : '';
      const fileName = file.name.includes('/') ? file.name.substring(file.name.lastIndexOf('/') + 1) : file.name;

      const entries = dirMap.get(parentDir);
      if (entries) {
        entries.push({ name: fileName, cid, size, type: LinkType.Blob });
      }
    }
  }

  // Build directories from deepest to root
  const sortedDirs = Array.from(dirMap.keys()).sort((a, b) => b.split('/').length - a.split('/').length);

  for (const dirPath of sortedDirs) {
    if (dirPath === '') continue; // Skip root for now

    const entries = dirMap.get(dirPath) || [];
    const { cid } = await tree.putDirectory(entries);

    const parentDir = dirPath.includes('/') ? dirPath.substring(0, dirPath.lastIndexOf('/')) : '';
    const dirName = dirPath.includes('/') ? dirPath.substring(dirPath.lastIndexOf('/') + 1) : dirPath;

    const parentEntries = dirMap.get(parentDir);
    if (parentEntries) {
      parentEntries.push({ name: dirName, cid, size: 0, type: LinkType.Dir });
    }
  }

  // Build root directory with updated .git
  const rootEntries = dirMap.get('') || [];

  // Build .git directory from checkout result (contains updated HEAD)
  const gitDirMap = new Map<string, Array<{ name: string; cid: CID; size: number; type: LinkType }>>();
  gitDirMap.set('.git', []);

  // Create directory entries for subdirectories
  for (const file of gitFiles) {
    if (file.isDir && file.name.startsWith('.git/')) {
      gitDirMap.set(file.name, []);
    }
  }

  // Process .git files
  for (const file of gitFiles) {
    if (!file.isDir && file.name.startsWith('.git/')) {
      const { cid, size } = await tree.putFile(file.data);
      const parentDir = file.name.substring(0, file.name.lastIndexOf('/'));
      const fileName = file.name.substring(file.name.lastIndexOf('/') + 1);

      const parentEntries = gitDirMap.get(parentDir);
      if (parentEntries) {
        parentEntries.push({ name: fileName, cid, size, type: LinkType.Blob });
      }
    }
  }

  // Build .git directories from deepest to root
  const sortedGitDirs = Array.from(gitDirMap.keys())
    .filter(d => d !== '.git')
    .sort((a, b) => b.split('/').length - a.split('/').length);

  for (const dirPathName of sortedGitDirs) {
    const dirEntries = gitDirMap.get(dirPathName) || [];
    const { cid } = await tree.putDirectory(dirEntries);

    const parentDir = dirPathName.substring(0, dirPathName.lastIndexOf('/'));
    const dirName = dirPathName.substring(dirPathName.lastIndexOf('/') + 1);

    const parentEntries = gitDirMap.get(parentDir);
    if (parentEntries) {
      parentEntries.push({ name: dirName, cid, size: 0, type: LinkType.Dir });
    }
  }

  // Build .git directory
  const gitEntries = gitDirMap.get('.git') || [];
  const { cid: gitCid } = await tree.putDirectory(gitEntries);

  rootEntries.push({ name: '.git', cid: gitCid, size: 0, type: LinkType.Dir });

  const { cid: finalCid } = await tree.putDirectory(rootEntries);
  return finalCid;
}

export interface RunGitCommandOptions {
  /** Author name for commits */
  authorName?: string;
  /** Author email for commits */
  authorEmail?: string;
}

export interface RunGitCommandResult {
  output: string;
  error?: string;
  /** Updated .git files for write commands - caller should persist these */
  gitFiles?: Array<{ name: string; data: Uint8Array; isDir: boolean }>;
}

/**
 * Run an arbitrary git command in a repository
 * Returns the command output and updated .git files for write commands
 */
export async function runGitCommand(
  rootCid: CID,
  command: string,
  options?: RunGitCommandOptions
): Promise<RunGitCommandResult> {
  const { runGitCommand: runGitCommandWasm } = await import('./wasmGit');
  return runGitCommandWasm(rootCid, command, options);
}

/**
 * Apply updated .git files to a directory, returning the new root CID
 */
export async function applyGitChanges(
  rootCid: CID,
  gitFiles: Array<{ name: string; data: Uint8Array; isDir: boolean }>
): Promise<CID> {
  const tree = getTree();

  // Build the new .git directory from gitFiles
  // First, organize files into a tree structure
  const dirMap = new Map<string, Array<{ name: string; cid: CID; size: number; type: LinkType }>>();
  dirMap.set('.git', []); // Root .git directory

  // Process directories first (sorted by depth to ensure parents exist)
  const sortedDirs = gitFiles
    .filter(f => f.isDir)
    .sort((a, b) => a.name.split('/').length - b.name.split('/').length);

  for (const dir of sortedDirs) {
    dirMap.set(dir.name, []);
  }

  // Process files
  for (const file of gitFiles) {
    if (file.isDir) continue;

    const { cid, size } = await tree.putFile(file.data);
    const parentDir = file.name.includes('/') ? file.name.substring(0, file.name.lastIndexOf('/')) : '.git';
    const fileName = file.name.includes('/') ? file.name.substring(file.name.lastIndexOf('/') + 1) : file.name;

    const entries = dirMap.get(parentDir);
    if (entries) {
      entries.push({ name: fileName, cid, size, type: LinkType.Blob });
    }
  }

  // Build directories from deepest to root
  const sortedDirKeys = Array.from(dirMap.keys()).sort((a, b) => b.split('/').length - a.split('/').length);

  for (const dirPath of sortedDirKeys) {
    if (dirPath === '.git') continue; // Handle root .git last

    const entries = dirMap.get(dirPath) || [];
    const { cid } = await tree.putDirectory(entries);

    const parentDir = dirPath.includes('/') ? dirPath.substring(0, dirPath.lastIndexOf('/')) : '.git';
    const dirName = dirPath.includes('/') ? dirPath.substring(dirPath.lastIndexOf('/') + 1) : dirPath;

    const parentEntries = dirMap.get(parentDir);
    if (parentEntries) {
      parentEntries.push({ name: dirName, cid, size: 0, type: LinkType.Dir });
    }
  }

  // Build root .git directory
  const gitRootEntries = dirMap.get('.git') || [];
  const { cid: newGitCid } = await tree.putDirectory(gitRootEntries);

  // Replace .git in the root directory
  const newRootCid = await tree.setEntry(rootCid, [], '.git', newGitCid, 0, LinkType.Dir);

  return newRootCid;
}
