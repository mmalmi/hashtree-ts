/**
 * Git-related hooks for detecting and interacting with git repos
 */
import { useState, useEffect } from 'react';
import type { CID } from 'hashtree';
import { isGitRepo, getBranches, getLog } from '../utils/git';

export interface GitInfo {
  isRepo: boolean;
  currentBranch: string | null;
  branches: string[];
  loading: boolean;
}

/**
 * Hook to detect if a directory is a git repo and get basic info
 */
export function useGitInfo(dirCid: CID | null): GitInfo {
  const [info, setInfo] = useState<GitInfo>({
    isRepo: false,
    currentBranch: null,
    branches: [],
    loading: true,
  });

  useEffect(() => {
    if (!dirCid) {
      setInfo({ isRepo: false, currentBranch: null, branches: [], loading: false });
      return;
    }

    let cancelled = false;

    async function check() {
      try {
        const isRepo = await isGitRepo(dirCid);
        if (cancelled) return;

        if (!isRepo) {
          setInfo({ isRepo: false, currentBranch: null, branches: [], loading: false });
          return;
        }

        const { branches, currentBranch } = await getBranches(dirCid);
        if (cancelled) return;

        setInfo({
          isRepo: true,
          currentBranch,
          branches,
          loading: false,
        });
      } catch (err) {
        console.error('Error checking git info:', err);
        if (!cancelled) {
          setInfo({ isRepo: false, currentBranch: null, branches: [], loading: false });
        }
      }
    }

    check();
    return () => { cancelled = true; };
  }, [dirCid?.hash ? Array.from(dirCid.hash).join(',') : null]);

  return info;
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
 * Hook to get commit history for a git repo
 */
export function useGitLog(dirCid: CID | null, depth = 20): {
  commits: CommitInfo[];
  loading: boolean;
  error: string | null;
} {
  const [state, setState] = useState<{
    commits: CommitInfo[];
    loading: boolean;
    error: string | null;
  }>({
    commits: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    if (!dirCid) {
      setState({ commits: [], loading: false, error: null });
      return;
    }

    let cancelled = false;

    async function fetchLog() {
      try {
        const commits = await getLog(dirCid, { depth });
        if (cancelled) return;
        setState({ commits, loading: false, error: null });
      } catch (err) {
        if (!cancelled) {
          setState({
            commits: [],
            loading: false,
            error: err instanceof Error ? err.message : 'Failed to load git log',
          });
        }
      }
    }

    fetchLog();
    return () => { cancelled = true; };
  }, [dirCid?.hash ? Array.from(dirCid.hash).join(',') : null, depth]);

  return state;
}
