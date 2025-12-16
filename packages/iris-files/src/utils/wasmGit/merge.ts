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
  workingFiles?: Array<{ name: string; data: Uint8Array; isDir: boolean }>;
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

      // Set up git config with user info
      try {
        module.FS.writeFile('/home/web_user/.gitconfig', `[user]\nname = ${authorName}\nemail = ${authorEmail}\n`);
      } catch {
        // May already exist
      }

      // Initialize a git repo first so it has proper structure
      // Then copy .git contents to overwrite it with our actual git data
      try {
        module.callMain(['init', '.']);
      } catch {
        // Ignore init errors
      }

      // Find .git directory in hashtree
      const gitDirResult = await tree.resolvePath(rootCid, '.git');
      if (!gitDirResult || gitDirResult.type !== LinkType.Dir) {
        return { success: false, error: 'Not a git repository' };
      }

      // Copy .git contents (overwrites the initialized .git)
      await copyToWasmFS(module, gitDirResult.cid, '.git');

      // Copy working directory files (excluding .git)
      const entries = await tree.listDirectory(rootCid);
      for (const entry of entries) {
        if (entry.name === '.git') continue;
        const entryPath = `./${entry.name}`;
        if (entry.type === LinkType.Dir) {
          try {
            module.FS.mkdir(entryPath);
          } catch {
            // May exist
          }
          await copyToWasmFS(module, entry.cid, entryPath);
        } else {
          const data = await tree.readFile(entry.cid);
          if (data) {
            module.FS.writeFile(entryPath, data);
          }
        }
      }

      // Debug: list what's in .git
      try {
        const gitEntries = module.FS.readdir('.git');
        console.log('[wasm-git] .git directory entries:', gitEntries);
        const headContent = module.FS.readFile('.git/HEAD', { encoding: 'utf8' });
        console.log('[wasm-git] .git/HEAD content:', headContent);
        // Check refs/heads
        const refsHeads = module.FS.readdir('.git/refs/heads');
        console.log('[wasm-git] refs/heads:', refsHeads);
        // Check objects
        const objectsDir = module.FS.readdir('.git/objects');
        console.log('[wasm-git] objects:', objectsDir);
        // Read master ref content
        const masterRef = module.FS.readFile('.git/refs/heads/master', { encoding: 'utf8' });
        console.log('[wasm-git] master ref:', masterRef.trim());
        // Check if object exists for master commit
        const masterHash = masterRef.trim();
        const objDir = masterHash.substring(0, 2);
        const objFile = masterHash.substring(2);
        console.log('[wasm-git] looking for object:', objDir + '/' + objFile);
        try {
          const objDirEntries = module.FS.readdir('.git/objects/' + objDir);
          console.log('[wasm-git] objects/' + objDir + ':', objDirEntries);
        } catch {
          console.log('[wasm-git] objects/' + objDir + ' does not exist');
        }
      } catch (e) {
        console.log('[wasm-git] debug error:', e);
      }

      // Try to verify objects
      try {
        const catFileOutput = module.callWithOutput(['cat-file', '-t', 'HEAD']);
        console.log('[wasm-git] cat-file -t HEAD:', catFileOutput);
        // Try various git log variants
        const logHead = module.callWithOutput(['log', 'HEAD', '--oneline', '-3']);
        console.log('[wasm-git] git log HEAD:', logHead);
        const logPlain = module.callWithOutput(['log', '--oneline', '-3']);
        console.log('[wasm-git] git log (plain):', logPlain);
      } catch (e) {
        console.log('[wasm-git] cat-file/log failed:', e);
      }

      // Checkout base branch first
      try {
        module.callWithOutput(['checkout', baseBranch]);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return { success: false, error: `Failed to checkout ${baseBranch}: ${errorMsg}` };
      }

      // Log current state before merge
      try {
        const logBefore = module.callWithOutput(['log', '--oneline', '--all', '-10']);
        console.log('[wasm-git] git log --all before merge:', logBefore);
      } catch (e) {
        console.log('[wasm-git] failed to get log before:', e);
      }

      // Check if this is a fast-forward merge
      let isFastForward = false;
      try {
        const mergeBaseOutput = module.callWithOutput(['merge-base', baseBranch, headBranch]) || '';
        const mergeBase = mergeBaseOutput.trim();

        const baseRefOutput = module.callWithOutput(['rev-parse', baseBranch]) || '';
        const baseCommit = baseRefOutput.trim();

        const headRefOutput = module.callWithOutput(['rev-parse', headBranch]) || '';
        const headCommit = headRefOutput.trim();

        console.log('[wasm-git] merge-base:', mergeBase);
        console.log('[wasm-git] base commit (' + baseBranch + '):', baseCommit);
        console.log('[wasm-git] head commit (' + headBranch + '):', headCommit);

        isFastForward = mergeBase === baseCommit;
        console.log('[wasm-git] isFastForward:', isFastForward);
      } catch (e) {
        console.log('[wasm-git] error checking fast-forward:', e);
        isFastForward = false;
      }

      // Perform the merge
      try {
        if (isFastForward) {
          // Fast-forward merge (just moves the branch pointer)
          const ffOutput = module.callWithOutput(['merge', '--ff-only', headBranch]);
          console.log('[wasm-git] fast-forward merge output:', ffOutput);
        } else {
          // Regular merge with commit message
          const mergeOutput = module.callWithOutput(['merge', '-m', commitMessage, headBranch]);
          console.log('[wasm-git] merge output:', mergeOutput);
        }

        // Verify the merge commit was created
        try {
          const logOutput = module.callWithOutput(['log', '--oneline', '-5']);
          console.log('[wasm-git] git log after merge:', logOutput);
        } catch (logErr) {
          console.error('[wasm-git] failed to get log:', logErr);
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
      console.log('[wasm-git] Read', gitFiles.length, 'git files');
      // Log important files
      const refsFiles = gitFiles.filter(f => f.name.includes('refs/'));
      console.log('[wasm-git] Refs files:', refsFiles.map(f => f.name));

      // Check what's in refs/heads/master
      const masterRef = gitFiles.find(f => f.name === '.git/refs/heads/master');
      if (masterRef && !masterRef.isDir) {
        console.log('[wasm-git] refs/heads/master content:', new TextDecoder().decode(masterRef.data).trim());
      }

      // Also check HEAD
      const headFile = gitFiles.find(f => f.name === '.git/HEAD');
      if (headFile && !headFile.isDir) {
        console.log('[wasm-git] HEAD content:', new TextDecoder().decode(headFile.data).trim());
      }

      // List objects
      const objectFiles = gitFiles.filter(f => f.name.includes('/objects/') && !f.isDir);
      console.log('[wasm-git] Object files count:', objectFiles.length);

      // Also read working directory files that were modified by the merge
      // These need to be applied to the hashtree as well
      const workingFiles: Array<{ name: string; data: Uint8Array; isDir: boolean }> = [];

      function readWorkingDir(dirPath: string, prefix: string): void {
        try {
          const entries = module.FS.readdir(dirPath);
          for (const entry of entries) {
            if (entry === '.' || entry === '..' || entry === '.git') continue;

            const fullPath = `${dirPath}/${entry}`;
            const relativePath = prefix ? `${prefix}/${entry}` : entry;

            try {
              const stat = module.FS.stat(fullPath);
              const isDir = (stat.mode & 0o170000) === 0o040000;
              if (isDir) {
                workingFiles.push({ name: relativePath, data: new Uint8Array(0), isDir: true });
                readWorkingDir(fullPath, relativePath);
              } else {
                const data = module.FS.readFile(fullPath) as Uint8Array;
                workingFiles.push({ name: relativePath, data, isDir: false });
              }
            } catch {
              // Skip files we can't read
            }
          }
        } catch {
          // Skip directories we can't read
        }
      }

      readWorkingDir('.', '');

      return { success: true, gitFiles, workingFiles, isFastForward };
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
