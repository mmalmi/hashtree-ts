/**
 * Git utilities using isomorphic-git with hashtree storage
 * All imports are lazy-loaded to avoid bundling ~100KB until needed
 */
import type { CID } from 'hashtree';

// Lazy-loaded modules
let gitModule: typeof import('isomorphic-git') | null = null;
let httpModule: typeof import('isomorphic-git/http/web') | null = null;

async function getGit() {
  if (!gitModule) {
    gitModule = await import('isomorphic-git');
  }
  return gitModule.default;
}

async function getHttp() {
  if (!httpModule) {
    httpModule = await import('isomorphic-git/http/web');
  }
  return httpModule.default;
}

async function getGitFS() {
  const { createGitFS } = await import('./git-fs');
  return createGitFS;
}

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
  const [git, http, createGitFS] = await Promise.all([getGit(), getHttp(), getGitFS()]);

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
  const [git, createGitFS] = await Promise.all([getGit(), getGitFS()]);

  const fs = createGitFS(rootCid);
  const dir = '/';

  try {
    const commits = await git.log({
      fs,
      dir,
      depth: options?.depth ?? 20,
    });

    if (!commits || !Array.isArray(commits)) {
      return [];
    }

    return commits
      .filter(commit => commit && commit.oid && commit.commit)
      .map(commit => ({
        oid: commit.oid,
        message: commit.commit.message ?? '',
        author: commit.commit.author?.name ?? 'Unknown',
        email: commit.commit.author?.email ?? '',
        timestamp: commit.commit.author?.timestamp ?? 0,
        parent: commit.commit.parent ?? [],
      }));
  } catch (err) {
    // Handle cases where repo has no commits or invalid refs
    const message = err instanceof Error ? err.message : String(err);
    console.error('[getLog] Error:', message);
    if (message.includes('Could not find') || message.includes('NotFoundError')) {
      return [];
    }
    throw err;
  }
}

/**
 * Get list of branches
 */
export async function getBranches(rootCid: CID) {
  const [git, createGitFS] = await Promise.all([getGit(), getGitFS()]);

  const fs = createGitFS(rootCid);
  const dir = '/';

  try {
    const branches = await git.listBranches({ fs, dir });
    const currentBranch = await git.currentBranch({ fs, dir });
    return { branches: branches ?? [], currentBranch: currentBranch ?? null };
  } catch {
    return { branches: [], currentBranch: null };
  }
}

/**
 * Get diff between two commits or working tree
 */
export async function getDiff(rootCid: CID, commitHash1: string, commitHash2?: string) {
  const [git, createGitFS] = await Promise.all([getGit(), getGitFS()]);

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
 * This check is lightweight - doesn't load isomorphic-git
 */
export async function isGitRepo(rootCid: CID): Promise<boolean> {
  const createGitFS = await getGitFS();
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
  const [git, createGitFS] = await Promise.all([getGit(), getGitFS()]);

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
export async function getBlame(_rootCid: CID, _filepath: string) {
  // isomorphic-git doesn't have built-in blame
  // Would need to walk commit history and check each line
  // For now, return null - can implement later if needed
  return null;
}
