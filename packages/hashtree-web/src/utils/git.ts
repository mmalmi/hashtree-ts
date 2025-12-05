/**
 * Git utilities using isomorphic-git with hashtree storage
 */
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import type { CID } from 'hashtree';
import { createGitFS } from './git-fs';

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
 */
export async function cloneRepo(options: CloneOptions): Promise<CloneResult> {
  const { url, ref, depth, onProgress } = options;
  const fs = createGitFS();
  const dir = '/';

  await git.clone({
    fs,
    http,
    dir,
    url,
    ref,
    depth,
    singleBranch: !!ref,
    onProgress: onProgress
      ? ({ phase, loaded, total }) => onProgress(phase, loaded, total || 0)
      : undefined,
    corsProxy: 'https://cors.isomorphic-git.org', // Public CORS proxy
  });

  // Commit filesystem changes to hashtree
  const rootCid = await fs._htfs.commit();

  // Get current ref
  const currentRef = await git.currentBranch({ fs, dir }) || 'HEAD';

  return { rootCid, ref: currentRef };
}

/**
 * Get commit log for a repository
 */
export async function getLog(rootCid: CID, options?: { depth?: number }) {
  const fs = createGitFS(rootCid);
  const dir = '/';

  const commits = await git.log({
    fs,
    dir,
    depth: options?.depth ?? 20,
  });

  return commits.map(commit => ({
    oid: commit.oid,
    message: commit.commit.message,
    author: commit.commit.author.name,
    email: commit.commit.author.email,
    timestamp: commit.commit.author.timestamp,
    parent: commit.commit.parent,
  }));
}

/**
 * Get list of branches
 */
export async function getBranches(rootCid: CID) {
  const fs = createGitFS(rootCid);
  const dir = '/';

  const branches = await git.listBranches({ fs, dir });
  const currentBranch = await git.currentBranch({ fs, dir });

  return { branches, currentBranch };
}

/**
 * Get diff between two commits or working tree
 */
export async function getDiff(rootCid: CID, commitHash1: string, commitHash2?: string) {
  const fs = createGitFS(rootCid);
  const dir = '/';

  // Get trees for both commits
  const walk = git.TREE({ ref: commitHash1 });
  const trees = commitHash2 ? [walk, git.TREE({ ref: commitHash2 })] : [walk];

  const changes: Array<{
    filepath: string;
    type: 'add' | 'remove' | 'modify';
  }> = [];

  await git.walk({
    fs,
    dir,
    trees,
    map: async (filepath, entries) => {
      if (!entries) return null;
      const [a, b] = entries;

      if (!a && b) {
        changes.push({ filepath, type: 'add' });
      } else if (a && !b) {
        changes.push({ filepath, type: 'remove' });
      } else if (a && b) {
        const aOid = await a.oid();
        const bOid = await b.oid();
        if (aOid !== bOid) {
          changes.push({ filepath, type: 'modify' });
        }
      }
      return null;
    },
  });

  return changes;
}

/**
 * Check if a directory contains a .git folder (is a git repo)
 */
export async function isGitRepo(rootCid: CID): Promise<boolean> {
  const fs = createGitFS(rootCid);

  try {
    const entries = await fs.promises.readdir('.git');
    return entries.includes('HEAD');
  } catch {
    return false;
  }
}

/**
 * Get file content at a specific commit
 */
export async function getFileAtCommit(
  rootCid: CID,
  filepath: string,
  commitHash: string
): Promise<Uint8Array | null> {
  const fs = createGitFS(rootCid);
  const dir = '/';

  try {
    const { blob } = await git.readBlob({
      fs,
      dir,
      oid: commitHash,
      filepath,
    });
    return blob;
  } catch {
    return null;
  }
}

/**
 * Get blame information for a file
 */
export async function getBlame(rootCid: CID, filepath: string) {
  // isomorphic-git doesn't have built-in blame
  // Would need to walk commit history and check each line
  // For now, return null - can implement later if needed
  return null;
}
