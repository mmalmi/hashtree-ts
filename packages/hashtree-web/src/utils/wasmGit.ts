/**
 * wasm-git wrapper for git operations
 * Uses libgit2 compiled to WebAssembly
 */
import type { CID } from 'hashtree';
import { LinkType } from 'hashtree';
import { getTree } from '../store';

// Module type from wasm-git
interface WasmGitModule {
  FS: {
    mkdir(path: string): void;
    writeFile(path: string, data: Uint8Array | string): void;
    readdir(path: string): string[];
    stat(path: string): { isDirectory(): boolean };
    readFile(path: string, opts?: { encoding?: string }): Uint8Array | string;
    chdir(path: string): void;
    cwd(): string;
    filesystems: { MEMFS: unknown };
    mount(fs: unknown, opts: unknown, path: string): void;
    unmount(path: string): void;
  };
  callMain(args: string[]): void;
  callWithOutput(args: string[]): string;
}

let wasmGitModule: WasmGitModule | null = null;
let moduleLoadPromise: Promise<WasmGitModule> | null = null;

/**
 * Load the wasm-git module (lazy, singleton)
 */
async function loadWasmGit(): Promise<WasmGitModule> {
  if (wasmGitModule) return wasmGitModule;
  if (moduleLoadPromise) return moduleLoadPromise;

  moduleLoadPromise = (async () => {
    // Configure wasm-git to load wasm from public directory
    (globalThis as Record<string, unknown>).wasmGitModuleOverrides = {
      locateFile: (path: string) => {
        // Return path to wasm file in public directory
        if (path.endsWith('.wasm')) {
          return '/lg2_async.wasm';
        }
        return path;
      },
    };

    // Import from node_modules (Vite will handle bundling the JS)
    // The wasm file is served from public directory
    const { default: createModule } = await import('wasm-git');
    wasmGitModule = await createModule();
    return wasmGitModule!;
  })();

  return moduleLoadPromise;
}

/**
 * Copy hashtree directory contents to wasm-git filesystem
 */
async function copyToWasmFS(
  module: WasmGitModule,
  cid: CID,
  destPath: string
): Promise<void> {
  const tree = getTree();
  const entries = await tree.listDirectory(cid);

  for (const entry of entries) {
    const entryPath = `${destPath}/${entry.name}`;

    if (entry.type === LinkType.Dir) {
      try {
        module.FS.mkdir(entryPath);
      } catch {
        // Directory may already exist
      }
      await copyToWasmFS(module, entry.cid, entryPath);
    } else {
      const data = await tree.readFile(entry.cid);
      if (data) {
        module.FS.writeFile(entryPath, data);
      }
    }
  }
}

/**
 * Get commit log using wasm-git
 */
export async function getLogWithWasmGit(
  rootCid: CID,
  options?: { depth?: number }
): Promise<Array<{
  oid: string;
  message: string;
  author: string;
  email: string;
  timestamp: number;
  parent: string[];
}>> {
  const tree = getTree();
  const depth = options?.depth ?? 20;

  // Check for .git directory
  const gitDirResult = await tree.resolvePath(rootCid, '.git');
  if (!gitDirResult || gitDirResult.type !== LinkType.Dir) {
    console.log('[wasm-git] No .git directory found');
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
      module.callMain(['init', '.']);
    } catch {
      // Ignore init errors
    }

    // Copy .git contents from hashtree to wasm filesystem
    // This overwrites the initialized .git with our actual git data
    await copyToWasmFS(module, gitDirResult.cid, '.git');

    // Run git log (wasm-git only supports basic format without options)
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
    const commits: Array<{
      oid: string;
      message: string;
      author: string;
      email: string;
      timestamp: number;
      parent: string[];
    }> = [];

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
}
