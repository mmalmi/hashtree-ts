/**
 * Git log and history operations
 */
import type { CID } from 'hashtree';
import { LinkType } from 'hashtree';
import { getTree } from '../../store';
import { withWasmGitLock, loadWasmGit, copyGitDirToWasmFS, rmRf } from './core';

/**
 * Get current HEAD commit SHA
 * Reads .git/HEAD and resolves refs directly from hashtree - no wasm needed
 */
export async function getHeadWithWasmGit(
  rootCid: CID
): Promise<string | null> {
  const tree = getTree();

  // Check for .git directory
  const gitDirResult = await tree.resolvePath(rootCid, '.git');
  if (!gitDirResult || gitDirResult.type !== LinkType.Dir) {
    return null;
  }

  try {
    // Read HEAD file
    const headResult = await tree.resolvePath(gitDirResult.cid, 'HEAD');
    if (!headResult || headResult.type === LinkType.Dir) {
      
      return null;
    }

    const headData = await tree.readFile(headResult.cid);
    if (!headData) {
      
      return null;
    }

    const headContent = new TextDecoder().decode(headData).trim();

    // Check if HEAD is a direct SHA (detached)
    if (/^[0-9a-f]{40}$/.test(headContent)) {
      
      return headContent;
    }

    // HEAD is a ref like "ref: refs/heads/master"
    const refMatch = headContent.match(/^ref: (.+)$/);
    if (!refMatch) {
      
      return null;
    }

    // Resolve the ref to get commit SHA
    const refPath = refMatch[1]; // e.g., "refs/heads/master"
    const refResult = await tree.resolvePath(gitDirResult.cid, refPath);
    if (!refResult || refResult.type === LinkType.Dir) {
      return null;
    }

    const refData = await tree.readFile(refResult.cid);
    if (!refData) {
      
      return null;
    }

    const sha = new TextDecoder().decode(refData).trim();
    return sha;
  } catch (err) {
    console.error('[git] getHead failed:', err);
    return null;
  }
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
/**
 * Decompress zlib data using browser's DecompressionStream
 */
async function decompressZlib(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate');
  const writer = ds.writable.getWriter();
  writer.write(data);
  writer.close();

  const chunks: Uint8Array[] = [];
  const reader = ds.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

// Cache for pack index data
let packIndexCache: Map<string, { fanout: Uint32Array; shas: string[]; offsets: number[] }> | null = null;
let packDataCache: Map<string, { cid: CID; size: number }> | null = null;

/**
 * Load pack index file (.idx) and return the SHA -> offset mapping
 */
async function loadPackIndex(
  tree: ReturnType<typeof getTree>,
  gitDirCid: CID,
  idxName: string
): Promise<{ fanout: Uint32Array; shas: string[]; offsets: number[] } | null> {
  try {
    const idxResult = await tree.resolvePath(gitDirCid, `objects/pack/${idxName}`);
    if (!idxResult || idxResult.type === LinkType.Dir) {
      return null;
    }

    const idxData = await tree.readFile(idxResult.cid);
    if (!idxData) return null;

    const view = new DataView(idxData.buffer, idxData.byteOffset, idxData.byteLength);

    // Check magic number (0xff744f63 for v2)
    if (view.getUint32(0) !== 0xff744f63) {
      
      return null;
    }

    // Version should be 2
    if (view.getUint32(4) !== 2) {
      
      return null;
    }

    // Fanout table (256 entries, 4 bytes each) starts at offset 8
    const fanout = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      fanout[i] = view.getUint32(8 + i * 4);
    }

    const numObjects = fanout[255];

    // SHA table starts after fanout (offset 8 + 256*4 = 1032)
    const shaOffset = 8 + 256 * 4;
    const shas: string[] = [];
    for (let i = 0; i < numObjects; i++) {
      const sha = Array.from(idxData.slice(shaOffset + i * 20, shaOffset + (i + 1) * 20))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      shas.push(sha);
    }

    // CRC table (skip it) - numObjects * 4 bytes
    const crcOffset = shaOffset + numObjects * 20;

    // Offset table starts after CRC
    const offsetOffset = crcOffset + numObjects * 4;
    const offsets: number[] = [];
    for (let i = 0; i < numObjects; i++) {
      offsets.push(view.getUint32(offsetOffset + i * 4));
    }

    return { fanout, shas, offsets };
  } catch (err) {
    return null;
  }
}

/**
 * Find object in pack files
 */
async function findInPack(
  tree: ReturnType<typeof getTree>,
  gitDirCid: CID,
  sha: string
): Promise<{ packName: string; offset: number } | null> {
  // List pack files
  const packDirResult = await tree.resolvePath(gitDirCid, 'objects/pack');
  if (!packDirResult || packDirResult.type !== LinkType.Dir) {
    
    return null;
  }

  const entries = await tree.listDirectory(packDirResult.cid);
  const idxFiles = entries.filter(e => e.name.endsWith('.idx'));

  for (const idxFile of idxFiles) {
    const idx = await loadPackIndex(tree, gitDirCid, idxFile.name);
    if (!idx) {
      continue;
    }

    
    const index = idx.shas.indexOf(sha);
    if (index !== -1) {
      const packName = idxFile.name.replace('.idx', '.pack');
      return { packName, offset: idx.offsets[index] };
    }
  }

  
  return null;
}

/**
 * Read object from pack file at given offset
 */
async function readFromPack(
  tree: ReturnType<typeof getTree>,
  gitDirCid: CID,
  packName: string,
  offset: number
): Promise<{ type: string; content: Uint8Array } | null> {
  try {
    const packResult = await tree.resolvePath(gitDirCid, `objects/pack/${packName}`);
    if (!packResult || packResult.type === LinkType.Dir) {
      return null;
    }

    const packData = await tree.readFile(packResult.cid);
    if (!packData) return null;

    // Read object header at offset
    let pos = offset;
    let byte = packData[pos++];
    const type = (byte >> 4) & 7;
    let size = byte & 15;
    let shift = 4;

    while (byte & 0x80) {
      byte = packData[pos++];
      size |= (byte & 0x7f) << shift;
      shift += 7;
    }

    // Type mapping: 1=commit, 2=tree, 3=blob, 4=tag, 6=ofs_delta, 7=ref_delta
    const typeNames = ['', 'commit', 'tree', 'blob', 'tag', '', 'ofs_delta', 'ref_delta'];
    const typeName = typeNames[type];

    if (type === 6 || type === 7) {
      // Delta objects - skip for now (would need to resolve base object)
      
      return null;
    }

    // Decompress the object data
    const compressedData = packData.slice(pos);
    const decompressed = await decompressZlib(compressedData);

    return { type: typeName, content: decompressed.slice(0, size) };
  } catch (err) {
    return null;
  }
}

/**
 * Read and parse a git object from hashtree (loose or packed)
 */
async function readGitObject(
  tree: ReturnType<typeof getTree>,
  gitDirCid: CID,
  sha: string
): Promise<{ type: string; content: Uint8Array } | null> {
  // Try loose object first: .git/objects/<sha[0:2]>/<sha[2:]>
  const objPath = `objects/${sha.slice(0, 2)}/${sha.slice(2)}`;

  try {
    const objResult = await tree.resolvePath(gitDirCid, objPath);
    if (objResult && objResult.type !== LinkType.Dir) {
      const compressedData = await tree.readFile(objResult.cid);
      if (compressedData) {
        // Decompress the object
        const decompressed = await decompressZlib(compressedData);

        // Parse: "<type> <size>\0<content>"
        const nullIndex = decompressed.indexOf(0);
        if (nullIndex !== -1) {
          const header = new TextDecoder().decode(decompressed.slice(0, nullIndex));
          const [type] = header.split(' ');
          const content = decompressed.slice(nullIndex + 1);
          return { type, content };
        }
      }
    }
  } catch {
    // Loose object not found, try pack files
  }

  // Try pack files
  const packInfo = await findInPack(tree, gitDirCid, sha);
  if (packInfo) {
    return readFromPack(tree, gitDirCid, packInfo.packName, packInfo.offset);
  }

  return null;
}

/**
 * Parse a git commit object
 */
function parseCommit(content: Uint8Array): {
  tree: string;
  parents: string[];
  author: string;
  email: string;
  timestamp: number;
  message: string;
} | null {
  const text = new TextDecoder().decode(content);
  const lines = text.split('\n');

  let tree = '';
  const parents: string[] = [];
  let author = '';
  let email = '';
  let timestamp = 0;
  let messageStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line === '') {
      messageStart = i + 1;
      break;
    }

    if (line.startsWith('tree ')) {
      tree = line.slice(5);
    } else if (line.startsWith('parent ')) {
      parents.push(line.slice(7));
    } else if (line.startsWith('author ')) {
      // Format: "author Name <email> timestamp timezone"
      const match = line.match(/^author (.+) <(.+)> (\d+)/);
      if (match) {
        author = match[1];
        email = match[2];
        timestamp = parseInt(match[3], 10);
      }
    }
  }

  const message = messageStart >= 0 ? lines.slice(messageStart).join('\n').trim() : '';

  return { tree, parents, author, email, timestamp, message };
}

/**
 * Get commit log by reading git objects directly from hashtree
 * No wasm-git needed - much faster for large repos
 */
export async function getLogWithWasmGit(
  rootCid: CID,
  options?: { depth?: number }
): Promise<CommitInfo[]> {
  const tree = getTree();
  const depth = options?.depth ?? 20;

  // Check for .git directory
  const gitDirResult = await tree.resolvePath(rootCid, '.git');
  if (!gitDirResult || gitDirResult.type !== LinkType.Dir) {
    return [];
  }

  try {
    // Get HEAD commit SHA
    const headSha = await getHeadWithWasmGit(rootCid);
    if (!headSha) {
      return [];
    }

    const commits: CommitInfo[] = [];
    const visited = new Set<string>();
    const queue = [headSha];

    while (queue.length > 0 && commits.length < depth) {
      const sha = queue.shift()!;
      if (visited.has(sha)) continue;
      visited.add(sha);

      const obj = await readGitObject(tree, gitDirResult.cid, sha);
      if (!obj || obj.type !== 'commit') {
        continue;
      }

      const parsed = parseCommit(obj.content);
      if (!parsed) {
        continue;
      }

      commits.push({
        oid: sha,
        message: parsed.message,
        author: parsed.author,
        email: parsed.email,
        timestamp: parsed.timestamp,
        parent: parsed.parents,
      });

      // Add parents to queue
      for (const parent of parsed.parents) {
        if (!visited.has(parent)) {
          queue.push(parent);
        }
      }
    }

    return commits;
  } catch (err) {
    console.error('[git] getLog failed:', err);
    return [];
  }
}

// Use wasm-git for commit log (slow - copies entire .git)
export async function getLogWithWasmGitSlow(
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

      // Only copy .git directory - much faster for read-only operations
      await copyGitDirToWasmFS(module, rootCid, '.');

      // Run git log from HEAD
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
        rmRf(module, repoPath);
      } catch {
        // Ignore errors
      }
    }
  });
}

/**
 * Get last commit info for files in a directory
 * Returns a map of filename -> commit info
 * @param rootCid - The root CID of the git repository
 * @param filenames - Array of filenames (base names only, not full paths)
 * @param subpath - Optional subdirectory path relative to git root (e.g., 'src' or 'src/utils')
 */
export async function getFileLastCommitsWithWasmGit(
  rootCid: CID,
  filenames: string[],
  subpath?: string
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

      // Only copy .git directory - git log only needs history, not working tree
      await copyGitDirToWasmFS(module, rootCid, '.');

      // For each file, get the last commit that touched it
      for (const filename of filenames) {
        // Skip .git directory
        if (filename === '.git') continue;

        try {
          // Build the full path relative to git root
          const fullPath = subpath ? `${subpath}/${filename}` : filename;
          // Run git log -1 -- <fullPath> to get last commit for this file
          const output = module.callWithOutput(['log', '-1', '--', fullPath]);

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
        rmRf(module, repoPath);
      } catch {
        // Ignore
      }
    }
  });
}
