/**
 * Git-related stores for detecting and interacting with git repos
 */
import { writable, type Readable } from 'svelte/store';
import type { CID } from 'hashtree';
import { isGitRepo, getBranches, getLog, getStatus, getHead } from '../utils/git';
import type { GitStatusResult } from '../utils/wasmGit';

export interface GitInfo {
  isRepo: boolean;
  currentBranch: string | null;
  branches: string[];
  loading: boolean;
}

export interface CommitInfo {
  oid: string;
  message: string;
  author: string;
  email: string;
  timestamp: number;
  parent: string[];
}

/**
 * Create a store to detect if a directory is a git repo and get basic info
 */
export function createGitInfoStore(dirCid: CID | null): Readable<GitInfo> {
  const { subscribe, set } = writable<GitInfo>({
    isRepo: false,
    currentBranch: null,
    branches: [],
    loading: true,
  });

  if (!dirCid) {
    set({ isRepo: false, currentBranch: null, branches: [], loading: false });
  } else {
    // Check if it's a git repo
    isGitRepo(dirCid).then(async (isRepo) => {
      if (!isRepo) {
        set({ isRepo: false, currentBranch: null, branches: [], loading: false });
        return;
      }

      try {
        const { branches, currentBranch } = await getBranches(dirCid);
        set({
          isRepo: true,
          currentBranch,
          branches,
          loading: false,
        });
      } catch (err) {
        console.error('Error getting git branches:', err);
        set({ isRepo: true, currentBranch: null, branches: [], loading: false });
      }
    }).catch((err) => {
      console.error('Error checking git repo:', err);
      set({ isRepo: false, currentBranch: null, branches: [], loading: false });
    });
  }

  return { subscribe };
}

/**
 * Create a store to get commit history for a git repo
 */
export function createGitLogStore(dirCid: CID | null, depth = 20): Readable<{
  commits: CommitInfo[];
  headOid: string | null;
  loading: boolean;
  error: string | null;
}> {
  const { subscribe, set } = writable<{
    commits: CommitInfo[];
    headOid: string | null;
    loading: boolean;
    error: string | null;
  }>({
    commits: [],
    headOid: null,
    loading: true,
    error: null,
  });

  if (!dirCid) {
    set({ commits: [], headOid: null, loading: false, error: null });
  } else {
    // Fetch both commits and HEAD in parallel
    Promise.all([
      getLog(dirCid, { depth }),
      getHead(dirCid),
    ]).then(([commits, headOid]) => {
      set({ commits, headOid, loading: false, error: null });
    }).catch((err) => {
      set({
        commits: [],
        headOid: null,
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load git log',
      });
    });
  }

  return { subscribe };
}

/**
 * Create a store to get git status (staged, unstaged, untracked files)
 */
export function createGitStatusStore(dirCid: CID | null): Readable<{
  status: GitStatusResult;
  loading: boolean;
  error: string | null;
}> & { refresh: () => void } {
  const emptyStatus: GitStatusResult = { staged: [], unstaged: [], untracked: [], hasChanges: false };
  const { subscribe, set } = writable<{
    status: GitStatusResult;
    loading: boolean;
    error: string | null;
  }>({
    status: emptyStatus,
    loading: true,
    error: null,
  });

  const currentCid = dirCid;

  function load() {
    if (!currentCid) {
      set({ status: emptyStatus, loading: false, error: null });
      return;
    }

    set({ status: emptyStatus, loading: true, error: null });

    getStatus(currentCid).then((status) => {
      set({ status, loading: false, error: null });
    }).catch((err) => {
      set({
        status: emptyStatus,
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to get git status',
      });
    });
  }

  // Initial load
  load();

  return {
    subscribe,
    refresh: () => load(),
  };
}
