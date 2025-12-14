/**
 * Core wasm-git utilities - module loading, locking, filesystem operations
 */
import type { CID } from 'hashtree';
import { LinkType } from 'hashtree';
import { getTree } from '../../store';

// Module type from wasm-git
export interface WasmGitModule {
  FS: {
    mkdir(path: string): void;
    writeFile(path: string, data: Uint8Array | string): void;
    readdir(path: string): string[];
    stat(path: string): { mode: number };
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

// Mutex for serializing access to wasm-git module (single-threaded wasm can't handle concurrent ops)
let wasmGitLock: Promise<void> = Promise.resolve();

/**
 * Execute a function with exclusive access to wasm-git module
 */
export async function withWasmGitLock<T>(fn: () => Promise<T>): Promise<T> {
  // Wait for any previous operation to complete
  const prevLock = wasmGitLock;
  let resolveLock: () => void;
  wasmGitLock = new Promise(resolve => { resolveLock = resolve; });
  await prevLock;
  try {
    return await fn();
  } finally {
    resolveLock!();
  }
}

/**
 * Load the wasm-git module (lazy, singleton)
 */
export async function loadWasmGit(): Promise<WasmGitModule> {
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
      // Suppress stdout logging (git log output goes to console.log by default)
      print: () => {},
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
export async function copyToWasmFS(
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
 * Read .git directory and return all files
 */
export function readGitDirectory(
  module: WasmGitModule,
  path: string = '.git',
  prefix: string = '.git'
): Array<{ name: string; data: Uint8Array; isDir: boolean }> {
  const gitFiles: Array<{ name: string; data: Uint8Array; isDir: boolean }> = [];

  function readDir(dirPath: string, dirPrefix: string): void {
    const entries = module.FS.readdir(dirPath);
    for (const entry of entries) {
      if (entry === '.' || entry === '..') continue;

      const fullPath = `${dirPath}/${entry}`;
      const relativePath = dirPrefix ? `${dirPrefix}/${entry}` : entry;

      try {
        const stat = module.FS.stat(fullPath);
        const isDir = (stat.mode & 0o170000) === 0o040000;
        if (isDir) {
          gitFiles.push({ name: relativePath, data: new Uint8Array(0), isDir: true });
          readDir(fullPath, relativePath);
        } else {
          const data = module.FS.readFile(fullPath) as Uint8Array;
          gitFiles.push({ name: relativePath, data, isDir: false });
        }
      } catch {
        // Skip files we can't read
      }
    }
  }

  readDir(path, prefix);
  return gitFiles;
}

/**
 * Parse command string into args, handling quoted strings
 */
export function parseCommandArgs(command: string): string[] {
  const args: string[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';

  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    if (inQuote) {
      if (char === quoteChar) {
        inQuote = false;
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      inQuote = true;
      quoteChar = char;
    } else if (char === ' ') {
      if (current) {
        args.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }

  if (current) {
    args.push(current);
  }

  return args;
}
