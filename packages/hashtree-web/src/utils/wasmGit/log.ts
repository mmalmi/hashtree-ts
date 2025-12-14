/**
 * Git log and history operations
 */
import type { CID } from 'hashtree';
import { LinkType } from 'hashtree';
import { getTree } from '../../store';
import { withWasmGitLock, loadWasmGit, copyToWasmFS, runSilent } from './core';

/**
 * Get current HEAD commit SHA
 * Reads .git/HEAD and resolves refs to get actual commit SHA
 */
export async function getHeadWithWasmGit(
  rootCid: CID
): Promise<string | null> {
  return withWasmGitLock(async () => {
    const tree = getTree();

    // Check for .git directory
    const gitDirResult = await tree.resolvePath(rootCid, '.git');
    if (!gitDirResult || gitDirResult.type !== LinkType.Dir) {
      return null;
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

      // Use rev-parse HEAD to get the commit SHA
      try {
        const output = module.callWithOutput(['rev-parse', 'HEAD']);
        if (output && output.trim().length === 40) {
          return output.trim();
        }
      } catch {
        // Ignore errors
      }

      return null;
    } catch (err) {
      console.error('[wasm-git] getHead failed:', err);
      return null;
    } finally {
      try {
        module.FS.chdir(originalCwd);
      } catch {
        // Ignore
      }
    }
  });
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
 * Get commit log using wasm-git
 */
export async function getLogWithWasmGit(
  rootCid: CID,
  options?: { depth?: number }
): Promise<CommitInfo[]> {
  return withWasmGitLock(async () => {
    const tree = getTree();
    const depth = options?.depth ?? 20;

    // Check for .git directory
    const gitDirResult = await tree.resolvePath(rootCid, '.git');
    if (!gitDirResult || gitDirResult.type !== LinkType.Dir) {
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
        runSilent(module, ['init', '.']);
      } catch {
        // Ignore init errors
      }

      // Copy .git contents from hashtree to wasm filesystem
      // This overwrites the initialized .git with our actual git data
      await copyToWasmFS(module, gitDirResult.cid, '.git');

      // Run git log from HEAD
      // Note: After checking out an older commit, only ancestors of HEAD are shown
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
      const commits: CommitInfo[] = [];

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
        runSilent(module, ['init', '.']);
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
