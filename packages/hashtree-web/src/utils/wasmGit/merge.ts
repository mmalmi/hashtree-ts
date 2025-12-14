/**
 * Git merge operations using wasm-git
 */
import type { CID } from 'hashtree';
import { LinkType } from 'hashtree';
import { getTree } from '../../store';
import { withWasmGitLock, loadWasmGit, copyToWasmFS, readGitDirectory } from './core';

export interface MergeResult {
  success: boolean;
  newRootCid?: CID;
  gitFiles?: Array<{ name: string; data: Uint8Array; isDir: boolean }>;
  conflicts?: string[];
  error?: string;
  isFastForward?: boolean;
}

/**
 * Merge head branch into base branch
 */
export async function mergeWithWasmGit(
  rootCid: CID,
  baseBranch: string,
  headBranch: string,
  commitMessage: string,
  authorName: string = 'User',
  authorEmail: string = 'user@example.com'
): Promise<MergeResult> {
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

      // Set up git config with user info
      try {
        module.FS.writeFile('/home/web_user/.gitconfig', `[user]\nname = ${authorName}\nemail = ${authorEmail}\n`);
      } catch {
        // May already exist
      }

      module.FS.chdir(repoPath);

      // Initialize git first (required for wasm-git to work properly)
      try {
        module.callMain(['init', '.']);
      } catch {
        // Ignore init errors
      }

      // Copy full working directory from hashtree (including .git)
      await copyToWasmFS(module, rootCid, '.');

      // Checkout base branch first
      try {
        module.callWithOutput(['checkout', baseBranch]);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return { success: false, error: `Failed to checkout ${baseBranch}: ${errorMsg}` };
      }

      // Check if this is a fast-forward merge
      let isFastForward = false;
      try {
        const mergeBaseOutput = module.callWithOutput(['merge-base', baseBranch, headBranch]) || '';
        const mergeBase = mergeBaseOutput.trim();

        const baseRefOutput = module.callWithOutput(['rev-parse', baseBranch]) || '';
        const baseCommit = baseRefOutput.trim();

        isFastForward = mergeBase === baseCommit;
      } catch {
        isFastForward = false;
      }

      // Perform the merge
      try {
        if (isFastForward) {
          // Fast-forward merge (just moves the branch pointer)
          module.callWithOutput(['merge', '--ff-only', headBranch]);
        } else {
          // Regular merge with commit message
          module.callWithOutput(['merge', '-m', commitMessage, headBranch]);
        }
      } catch (err) {
        // Merge failed, likely due to conflicts
        const conflicts: string[] = [];
        try {
          const statusOutput = module.callWithOutput(['status', '--porcelain']) || '';
          const lines = statusOutput.split('\n');
          for (const line of lines) {
            // UU = both modified (conflict)
            // AA = both added
            // DD = both deleted
            if (line.match(/^(UU|AA|DD|AU|UA|DU|UD)/)) {
              const file = line.slice(3).trim();
              if (file) conflicts.push(file);
            }
          }
        } catch {
          // Can't get status
        }

        // Abort the merge
        try {
          module.callWithOutput(['merge', '--abort']);
        } catch {
          // Ignore abort errors
        }

        if (conflicts.length > 0) {
          return { success: false, conflicts, error: `Merge conflicts in: ${conflicts.join(', ')}` };
        }

        const errorMsg = err instanceof Error ? err.message : String(err);
        return { success: false, error: `Merge failed: ${errorMsg}` };
      }

      // Read the updated .git directory
      const gitFiles = readGitDirectory(module);

      return { success: true, gitFiles, isFastForward };
    } catch (err) {
      console.error('[wasm-git] merge failed:', err);
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      try {
        module.FS.chdir(originalCwd);
      } catch {
        // Ignore
      }
    }
  });
}
