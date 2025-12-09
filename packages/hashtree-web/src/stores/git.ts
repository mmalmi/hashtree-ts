/**
 * Git-related stores for detecting and interacting with git repos
 */
import { writable, type Readable } from 'svelte/store';
import type { CID } from 'hashtree';
import { isGitRepo, getBranches, getLog } from '../utils/git';

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
  loading: boolean;
  error: string | null;
}> {
  const { subscribe, set } = writable<{
    commits: CommitInfo[];
    loading: boolean;
    error: string | null;
  }>({
    commits: [],
    loading: true,
    error: null,
  });

  if (!dirCid) {
    set({ commits: [], loading: false, error: null });
  } else {
    getLog(dirCid, { depth }).then((commits) => {
      set({ commits, loading: false, error: null });
    }).catch((err) => {
      set({
        commits: [],
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load git log',
      });
    });
  }

  return { subscribe };
}
