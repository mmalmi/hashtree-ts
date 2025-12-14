/**
 * Git branch operations
 */
import type { CID } from 'hashtree';
import { LinkType } from 'hashtree';
import { getTree } from '../../store';
import { withWasmGitLock, loadWasmGit, copyToWasmFS, runSilent, rmRf } from './core';

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
        runSilent(module, ['init', '.']);
      } catch {
        // Ignore init errors
      }

      await copyToWasmFS(module, gitDirResult.cid, '.git');

      // Get current branch from status
      let currentBranch: string | null = null;
      try {
        const statusOutput = module.callWithOutput(['status']);
        // Check for detached HEAD first
        if (statusOutput.includes('HEAD detached') || statusOutput.includes('detached HEAD')) {
          currentBranch = null; // Explicitly detached
        } else {
          const branchMatch = statusOutput.match(/On branch (\S+)/);
          if (branchMatch && branchMatch[1] !== 'HEAD') {
            currentBranch = branchMatch[1];
          }
        }
      } catch {
        // Ignore
      }

      // Get list of branches by reading refs/heads directory directly
      // wasm-git has limited commands (no 'branch', no 'for-each-ref')
      const branches: string[] = [];
      try {
        const refsHeadsPath = '.git/refs/heads';
        const branchFiles = module.FS.readdir(refsHeadsPath);
        for (const file of branchFiles) {
          if (file !== '.' && file !== '..') {
            branches.push(file);
          }
        }
      } catch {
        // refs/heads may not exist
      }

      return { branches, currentBranch };
    } catch (err) {
      console.error('[wasm-git] getBranches failed:', err);
      return { branches: [], currentBranch: null };
    } finally {
      try {
        module.FS.chdir(originalCwd);
        rmRf(module, repoPath);
      } catch {
        // Ignore
      }
    }
  });
}

/**
 * Create a new branch using wasm-git
 */
export async function createBranchWithWasmGit(
  rootCid: CID,
  branchName: string,
  checkout: boolean = true
): Promise<{ success: boolean; error?: string }> {
  return withWasmGitLock(async () => {
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
        runSilent(module, ['init', '.']);
      } catch {
        // Ignore init errors
      }

      await copyToWasmFS(module, gitDirResult.cid, '.git');

      // Create the branch
      try {
        if (checkout) {
          runSilent(module, ['checkout', '-b', branchName]);
        } else {
          runSilent(module, ['branch', branchName]);
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
        rmRf(module, repoPath);
      } catch {
        // Ignore
      }
    }
  });
}
