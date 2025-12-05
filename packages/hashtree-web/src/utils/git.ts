/**
 * Git utilities using direct git object parsing
 * Reads git objects directly from hashtree storage
 * Supports both loose objects and pack files
 */
import type { CID, HashTree } from 'hashtree';
import { getTree } from '../store';
import { unzlibSync, inflateSync } from 'fflate';

// Git object types
const OBJ_COMMIT = 1;
const OBJ_TREE = 2;
const OBJ_BLOB = 3;
const OBJ_TAG = 4;
const OBJ_OFS_DELTA = 6;
const OBJ_REF_DELTA = 7;

const TYPE_NAMES: Record<number, string> = {
  [OBJ_COMMIT]: 'commit',
  [OBJ_TREE]: 'tree',
  [OBJ_BLOB]: 'blob',
  [OBJ_TAG]: 'tag',
};

/**
 * Pack file index - maps SHA to offset in pack
 */
interface PackIndex {
  packCid: CID;
  indexData: Uint8Array;
  packData: Uint8Array | null; // Lazy loaded
  version: number;
  fanout: Uint32Array;
  numObjects: number;
}

/**
 * Helper class to read git objects directly from hashtree
 */
class GitObjectReader {
  private packIndexes: PackIndex[] | null = null;
  private packDataCache: Map<string, Uint8Array> = new Map();

  constructor(
    private tree: HashTree,
    private gitDirCid: CID
  ) {}

  /**
   * Read and parse a git object by its SHA hash
   * Tries loose objects first, then pack files
   */
  async readObject(sha: string): Promise<{ type: string; data: Uint8Array } | null> {
    // Try loose object first
    const loose = await this.readLooseObject(sha);
    if (loose) return loose;

    // Try pack files
    return this.readPackedObject(sha);
  }

  /**
   * Read a loose object from .git/objects/XX/YYYYYY
   */
  private async readLooseObject(sha: string): Promise<{ type: string; data: Uint8Array } | null> {
    const dir = sha.substring(0, 2);
    const file = sha.substring(2);

    try {
      const objectsDirResult = await this.tree.resolvePath(this.gitDirCid, 'objects');
      if (!objectsDirResult || !objectsDirResult.isTree) return null;

      const subDirResult = await this.tree.resolvePath(objectsDirResult.cid, dir);
      if (!subDirResult || !subDirResult.isTree) return null;

      const fileResult = await this.tree.resolvePath(subDirResult.cid, file);
      if (!fileResult || fileResult.isTree) return null;

      const compressed = await this.tree.readFile(fileResult.cid);
      if (!compressed) return null;

      // Decompress using zlib
      const decompressed = unzlibSync(compressed);

      // Parse git object format: "type size\0data"
      const nullIndex = decompressed.indexOf(0);
      if (nullIndex === -1) return null;

      const header = new TextDecoder().decode(decompressed.slice(0, nullIndex));
      const [type] = header.split(' ');
      const data = decompressed.slice(nullIndex + 1);

      return { type, data };
    } catch {
      return null;
    }
  }

  /**
   * Load pack indexes from .git/objects/pack/
   */
  private async loadPackIndexes(): Promise<PackIndex[]> {
    if (this.packIndexes !== null) return this.packIndexes;

    this.packIndexes = [];

    try {
      const objectsDirResult = await this.tree.resolvePath(this.gitDirCid, 'objects');
      if (!objectsDirResult || !objectsDirResult.isTree) return this.packIndexes;

      const packDirResult = await this.tree.resolvePath(objectsDirResult.cid, 'pack');
      if (!packDirResult || !packDirResult.isTree) return this.packIndexes;

      const entries = await this.tree.listDirectory(packDirResult.cid);

      // Find .idx files and their corresponding .pack files
      for (const entry of entries) {
        if (!entry.name.endsWith('.idx')) continue;

        const baseName = entry.name.slice(0, -4);
        const packEntry = entries.find(e => e.name === baseName + '.pack');
        if (!packEntry) continue;

        // Read the index file
        const idxResult = await this.tree.resolvePath(packDirResult.cid, entry.name);
        if (!idxResult || idxResult.isTree) continue;

        const indexData = await this.tree.readFile(idxResult.cid);
        if (!indexData) continue;

        // Get pack file CID (don't load data yet - lazy load)
        const packResult = await this.tree.resolvePath(packDirResult.cid, packEntry.name);
        if (!packResult || packResult.isTree) continue;

        // Parse index header
        const view = new DataView(indexData.buffer, indexData.byteOffset, indexData.byteLength);

        // Check magic number (0xff744f63 for v2)
        const magic = view.getUint32(0);
        if (magic !== 0xff744f63) continue; // Not v2 index

        const version = view.getUint32(4);
        if (version !== 2) continue; // Only support v2

        // Fanout table starts at offset 8
        const fanout = new Uint32Array(256);
        for (let i = 0; i < 256; i++) {
          fanout[i] = view.getUint32(8 + i * 4);
        }

        const numObjects = fanout[255];

        this.packIndexes.push({
          packCid: packResult.cid,
          indexData,
          packData: null,
          version,
          fanout,
          numObjects,
        });
      }
    } catch {
      // Ignore errors loading pack indexes
    }

    return this.packIndexes;
  }

  /**
   * Look up SHA in pack index and return offset
   */
  private findInPackIndex(pack: PackIndex, sha: string): number | null {
    const shaBytes = hexToBytes(sha);
    const firstByte = shaBytes[0];

    // Get range from fanout table
    const start = firstByte === 0 ? 0 : pack.fanout[firstByte - 1];
    const end = pack.fanout[firstByte];

    if (start >= end) return null;

    const indexData = pack.indexData;
    const view = new DataView(indexData.buffer, indexData.byteOffset, indexData.byteLength);

    // SHA list starts after fanout table (8 + 256*4 = 1032)
    const shaListOffset = 8 + 256 * 4;

    // Binary search in the SHA list
    let lo = start;
    let hi = end;

    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const entryOffset = shaListOffset + mid * 20;

      // Compare SHA
      let cmp = 0;
      for (let i = 0; i < 20 && cmp === 0; i++) {
        cmp = shaBytes[i] - indexData[entryOffset + i];
      }

      if (cmp === 0) {
        // Found! Get offset from offset table
        // Offset table is after SHA list and CRC table
        const crcTableOffset = shaListOffset + pack.numObjects * 20;
        const offsetTableOffset = crcTableOffset + pack.numObjects * 4;
        const offset = view.getUint32(offsetTableOffset + mid * 4);

        // Check if it's a large offset (MSB set)
        if (offset & 0x80000000) {
          // Large offset - need to read from 64-bit table
          const largeOffsetTableOffset = offsetTableOffset + pack.numObjects * 4;
          const largeIndex = offset & 0x7fffffff;
          const highBits = view.getUint32(largeOffsetTableOffset + largeIndex * 8);
          const lowBits = view.getUint32(largeOffsetTableOffset + largeIndex * 8 + 4);
          return highBits * 0x100000000 + lowBits;
        }

        return offset;
      } else if (cmp < 0) {
        hi = mid;
      } else {
        lo = mid + 1;
      }
    }

    return null;
  }

  /**
   * Read an object from a pack file
   */
  private async readPackedObject(sha: string): Promise<{ type: string; data: Uint8Array } | null> {
    const indexes = await this.loadPackIndexes();

    for (const pack of indexes) {
      const offset = this.findInPackIndex(pack, sha);
      if (offset === null) continue;

      // Load pack data if not cached
      if (!pack.packData) {
        const packKey = Array.from(pack.packCid.hash).join(',');
        let cached = this.packDataCache.get(packKey);
        if (!cached) {
          const data = await this.tree.readFile(pack.packCid);
          if (!data) continue;
          cached = data;
          this.packDataCache.set(packKey, cached);
        }
        pack.packData = cached;
      }

      const result = await this.readObjectAtOffset(pack.packData, offset, pack);
      if (result) return result;
    }

    return null;
  }

  /**
   * Read an object at a specific offset in a pack file
   */
  private async readObjectAtOffset(
    packData: Uint8Array,
    offset: number,
    pack: PackIndex
  ): Promise<{ type: string; data: Uint8Array } | null> {
    try {
      let pos = offset;

      // Read type and size (variable-length encoding)
      let byte = packData[pos++];
      const type = (byte >> 4) & 0x7;
      let size = byte & 0xf;
      let shift = 4;

      while (byte & 0x80) {
        byte = packData[pos++];
        size |= (byte & 0x7f) << shift;
        shift += 7;
      }

      if (type === OBJ_OFS_DELTA) {
        // Offset delta - read negative offset to base object
        byte = packData[pos++];
        let baseOffset = byte & 0x7f;
        while (byte & 0x80) {
          byte = packData[pos++];
          baseOffset = ((baseOffset + 1) << 7) | (byte & 0x7f);
        }

        // Decompress delta data
        const deltaData = this.decompressAt(packData, pos);
        if (!deltaData) return null;

        // Read base object
        const baseResult = await this.readObjectAtOffset(packData, offset - baseOffset, pack);
        if (!baseResult) return null;

        // Apply delta
        const result = applyDelta(baseResult.data, deltaData);
        if (!result) return null;

        return { type: baseResult.type, data: result };
      } else if (type === OBJ_REF_DELTA) {
        // Ref delta - 20-byte SHA of base object
        const baseSha = bytesToHex(packData.slice(pos, pos + 20));
        pos += 20;

        // Decompress delta data
        const deltaData = this.decompressAt(packData, pos);
        if (!deltaData) return null;

        // Read base object (may be in another pack or loose)
        const baseResult = await this.readObject(baseSha);
        if (!baseResult) return null;

        // Apply delta
        const result = applyDelta(baseResult.data, deltaData);
        if (!result) return null;

        return { type: baseResult.type, data: result };
      } else {
        // Regular object - just decompress
        const typeName = TYPE_NAMES[type];
        if (!typeName) return null;

        const data = this.decompressAt(packData, pos);
        if (!data) return null;

        return { type: typeName, data };
      }
    } catch {
      return null;
    }
  }

  /**
   * Decompress zlib data at offset
   */
  private decompressAt(data: Uint8Array, offset: number): Uint8Array | null {
    try {
      // inflateSync from fflate handles raw deflate, but git uses zlib
      // Try to decompress from the offset
      const slice = data.slice(offset);
      return unzlibSync(slice);
    } catch {
      // If zlib fails, try raw deflate (some pack objects use this)
      try {
        const slice = data.slice(offset);
        return inflateSync(slice);
      } catch {
        return null;
      }
    }
  }

  /**
   * Read HEAD ref to get current branch
   */
  async readHead(): Promise<string | null> {
    try {
      const headResult = await this.tree.resolvePath(this.gitDirCid, 'HEAD');
      if (!headResult || headResult.isTree) return null;

      const data = await this.tree.readFile(headResult.cid);
      if (!data) return null;

      const content = new TextDecoder().decode(data).trim();
      // HEAD contains either "ref: refs/heads/branch" or a direct sha
      if (content.startsWith('ref: ')) {
        return content.substring(5); // Return the ref path
      }
      return content; // Direct SHA
    } catch {
      return null;
    }
  }

  /**
   * Read a ref file to get the commit SHA
   */
  async readRef(refPath: string): Promise<string | null> {
    try {
      const refResult = await this.tree.resolvePath(this.gitDirCid, refPath);
      if (!refResult || refResult.isTree) return null;

      const data = await this.tree.readFile(refResult.cid);
      if (!data) return null;

      return new TextDecoder().decode(data).trim();
    } catch {
      return null;
    }
  }

  /**
   * Resolve HEAD to a commit SHA
   */
  async resolveHead(): Promise<string | null> {
    const head = await this.readHead();
    if (!head) return null;

    // If HEAD is a ref, resolve it
    if (head.startsWith('refs/')) {
      return this.readRef(head);
    }

    // HEAD is a direct SHA
    return head;
  }

  /**
   * Parse a commit object
   */
  parseCommit(data: Uint8Array): {
    tree: string;
    parent: string[];
    author: string;
    email: string;
    timestamp: number;
    message: string;
  } | null {
    const content = new TextDecoder().decode(data);
    const lines = content.split('\n');

    let tree = '';
    const parent: string[] = [];
    let author = '';
    let email = '';
    let timestamp = 0;
    let messageStartIndex = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === '') {
        messageStartIndex = i + 1;
        break;
      }

      if (line.startsWith('tree ')) {
        tree = line.substring(5);
      } else if (line.startsWith('parent ')) {
        parent.push(line.substring(7));
      } else if (line.startsWith('author ')) {
        // Format: author Name <email> timestamp timezone
        const authorMatch = line.match(/^author (.+?) <(.+?)> (\d+)/);
        if (authorMatch) {
          author = authorMatch[1];
          email = authorMatch[2];
          timestamp = parseInt(authorMatch[3], 10);
        }
      }
    }

    const message = lines.slice(messageStartIndex).join('\n').trim();

    return { tree, parent, author, email, timestamp, message };
  }

  /**
   * Get commit log starting from HEAD
   */
  async getLog(depth: number = 20): Promise<Array<{
    oid: string;
    message: string;
    author: string;
    email: string;
    timestamp: number;
    parent: string[];
  }>> {
    const commits: Array<{
      oid: string;
      message: string;
      author: string;
      email: string;
      timestamp: number;
      parent: string[];
    }> = [];

    // Start from HEAD
    let currentSha = await this.resolveHead();
    const visited = new Set<string>();

    while (currentSha && commits.length < depth && !visited.has(currentSha)) {
      visited.add(currentSha);

      const obj = await this.readObject(currentSha);
      if (!obj || obj.type !== 'commit') break;

      const parsed = this.parseCommit(obj.data);
      if (!parsed) break;

      commits.push({
        oid: currentSha,
        message: parsed.message,
        author: parsed.author,
        email: parsed.email,
        timestamp: parsed.timestamp,
        parent: parsed.parent,
      });

      // Move to first parent (main line)
      currentSha = parsed.parent[0] || null;
    }

    return commits;
  }

  /**
   * List branches by reading refs/heads
   */
  async getBranches(): Promise<{ branches: string[]; currentBranch: string | null }> {
    const branches: string[] = [];
    let currentBranch: string | null = null;

    // Get current branch from HEAD
    const head = await this.readHead();
    if (head && head.startsWith('refs/heads/')) {
      currentBranch = head.substring('refs/heads/'.length);
    }

    try {
      // Read refs/heads directory
      const refsResult = await this.tree.resolvePath(this.gitDirCid, 'refs');
      if (!refsResult || !refsResult.isTree) return { branches, currentBranch };

      const headsResult = await this.tree.resolvePath(refsResult.cid, 'heads');
      if (!headsResult || !headsResult.isTree) return { branches, currentBranch };

      const entries = await this.tree.listDirectory(headsResult.cid);
      for (const entry of entries) {
        if (!entry.isTree) {
          branches.push(entry.name);
        }
      }
    } catch {
      // Ignore errors
    }

    return { branches, currentBranch };
  }
}

// Helper functions for pack file parsing

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Apply a git delta to a base object to produce the target object
 * Delta format: https://git-scm.com/docs/pack-format
 */
function applyDelta(base: Uint8Array, delta: Uint8Array): Uint8Array | null {
  try {
    let pos = 0;

    // Read source size (variable-length encoding)
    let sourceSize = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = delta[pos++];
      sourceSize |= (byte & 0x7f) << shift;
      shift += 7;
    } while (byte & 0x80);

    // Verify source size matches base
    if (sourceSize !== base.length) return null;

    // Read target size
    let targetSize = 0;
    shift = 0;
    do {
      byte = delta[pos++];
      targetSize |= (byte & 0x7f) << shift;
      shift += 7;
    } while (byte & 0x80);

    // Apply delta instructions
    const result = new Uint8Array(targetSize);
    let resultPos = 0;

    while (pos < delta.length) {
      const cmd = delta[pos++];

      if (cmd & 0x80) {
        // Copy from base
        let copyOffset = 0;
        let copySize = 0;

        if (cmd & 0x01) copyOffset = delta[pos++];
        if (cmd & 0x02) copyOffset |= delta[pos++] << 8;
        if (cmd & 0x04) copyOffset |= delta[pos++] << 16;
        if (cmd & 0x08) copyOffset |= delta[pos++] << 24;

        if (cmd & 0x10) copySize = delta[pos++];
        if (cmd & 0x20) copySize |= delta[pos++] << 8;
        if (cmd & 0x40) copySize |= delta[pos++] << 16;

        if (copySize === 0) copySize = 0x10000;

        result.set(base.subarray(copyOffset, copyOffset + copySize), resultPos);
        resultPos += copySize;
      } else if (cmd > 0) {
        // Insert new data
        result.set(delta.subarray(pos, pos + cmd), resultPos);
        pos += cmd;
        resultPos += cmd;
      } else {
        // Reserved (cmd === 0)
        return null;
      }
    }

    if (resultPos !== targetSize) return null;

    return result;
  } catch {
    return null;
  }
}

export interface CloneOptions {
  url: string;
  /** Optional branch/ref to checkout (default: default branch) */
  ref?: string;
  /** Shallow clone depth (default: full clone) */
  depth?: number;
  /** Progress callback */
  onProgress?: (phase: string, loaded: number, total: number) => void;
}

export interface CloneResult {
  /** Root CID of the cloned repository */
  rootCid: CID;
  /** Current branch/ref */
  ref: string;
}

/**
 * Clone a git repository into hashtree storage
 * Note: Clone functionality requires network access and CORS proxy
 */
export async function cloneRepo(_options: CloneOptions): Promise<CloneResult> {
  // Clone is complex with wasm-git - requires CORS proxy setup
  // For now, throw not implemented
  throw new Error('Clone not yet implemented with wasm-git. Upload a git repo folder instead.');
}

type CommitLog = Array<{
  oid: string;
  message: string;
  author: string;
  email: string;
  timestamp: number;
  parent: string[];
}>;

/**
 * Get commit log for a repository
 * Reads git objects directly from hashtree storage
 */
export async function getLog(rootCid: CID, options?: { depth?: number }): Promise<CommitLog>;
export async function getLog(rootCid: CID, options: { depth?: number; debug: true }): Promise<{ commits: CommitLog; debug: string[] }>;
export async function getLog(rootCid: CID, options?: { depth?: number; debug?: boolean }): Promise<CommitLog | { commits: CommitLog; debug: string[] }> {
  const tree = getTree();
  const debugInfo: string[] = [];

  try {
    const depth = options?.depth ?? 20;

    // Find .git directory
    const gitDirResult = await tree.resolvePath(rootCid, '.git');
    if (!gitDirResult || !gitDirResult.isTree) {
      debugInfo.push('No .git directory found');
      if (options?.debug) {
        return { commits: [], debug: debugInfo };
      }
      return [];
    }

    debugInfo.push('.git directory found');

    const reader = new GitObjectReader(tree, gitDirResult.cid);

    // Debug: check HEAD
    const head = await reader.readHead();
    debugInfo.push(`HEAD: ${head}`);

    const headSha = await reader.resolveHead();
    debugInfo.push(`HEAD SHA: ${headSha}`);

    // Get commits
    const commits = await reader.getLog(depth);
    debugInfo.push(`Found ${commits.length} commits`);

    if (options?.debug) {
      return { commits, debug: debugInfo };
    }

    return commits;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    debugInfo.push(`Error: ${message}`);

    if (options?.debug) {
      return { commits: [], debug: debugInfo };
    }
    return [];
  }
}

/**
 * Get list of branches
 */
export async function getBranches(rootCid: CID) {
  const tree = getTree();

  try {
    const gitDirResult = await tree.resolvePath(rootCid, '.git');
    if (!gitDirResult || !gitDirResult.isTree) {
      return { branches: [], currentBranch: null };
    }

    const reader = new GitObjectReader(tree, gitDirResult.cid);
    return reader.getBranches();
  } catch {
    return { branches: [], currentBranch: null };
  }
}

/**
 * Get diff between two commits or working tree
 * Note: Full diff implementation requires tree walking - not yet implemented
 */
export async function getDiff(_rootCid: CID, _commitHash1: string, _commitHash2?: string) {
  // TODO: Implement tree walking to compute diff
  return [];
}

/**
 * Check if a directory contains a .git folder (is a git repo)
 * This check is lightweight - doesn't load wasm-git
 */
export async function isGitRepo(rootCid: CID): Promise<boolean> {
  const tree = getTree();

  try {
    // Check for .git directory
    const gitDirResult = await tree.resolvePath(rootCid, '.git');
    if (!gitDirResult || !gitDirResult.isTree) {
      return false;
    }

    // Check for HEAD file inside .git
    const headResult = await tree.resolvePath(gitDirResult.cid, 'HEAD');
    return headResult !== null && !headResult.isTree;
  } catch {
    return false;
  }
}

/**
 * Get file content at a specific commit
 * Note: Requires tree walking from commit to find blob - not yet implemented
 */
export async function getFileAtCommit(
  _rootCid: CID,
  _filepath: string,
  _commitHash: string
): Promise<Uint8Array | null> {
  // TODO: Implement tree walking to find blob at path
  return null;
}

/**
 * Get blame information for a file
 */
export async function getBlame(_rootCid: CID, _filepath: string) {
  // git blame would need to be implemented
  // For now, return null
  return null;
}
