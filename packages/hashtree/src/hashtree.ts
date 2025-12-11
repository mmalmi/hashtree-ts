/**
 * HashTree - Unified merkle tree operations
 *
 * Single class for creating, reading, and editing content-addressed merkle trees.
 *
 * All files are encrypted by default using CHK (Content Hash Key) encryption.
 * Use the "Public" variants (putFilePublic, readFilePublic) for unencrypted storage.
 */

import { Store, Hash, CID, TreeNode, NodeType, Link, toHex, cid } from './types.js';
import { decodeTreeNode, isTreeNode, encodeAndHash } from './codec.js';
import { sha256 } from './hash.js';
import { encryptChk, type EncryptionKey } from './crypto.js';
import * as create from './tree/create.js';
import * as read from './tree/read.js';
import * as edit from './tree/edit.js';
import {
  putFileEncrypted,
  readFileEncrypted,
  readFileEncryptedStream,
  readFileEncryptedRange,
  putDirectoryEncrypted,
  listDirectoryEncrypted,
  getTreeNodeEncrypted,
  type EncryptedDirEntry,
} from './encrypted.js';
import * as editEncrypted from './tree/editEncrypted.js';

/** Default chunk size: 16KB (BitTorrent v2 compatible) */
export const DEFAULT_CHUNK_SIZE = 16 * 1024;

/** Default max links per tree node (fanout) */
export const DEFAULT_MAX_LINKS = 174;

export interface HashTreeConfig {
  store: Store;
  chunkSize?: number;
  maxLinks?: number;
}

export interface TreeEntry {
  name: string;
  cid: CID;
  size?: number;
  isTree: boolean;
}

export interface DirEntry {
  name: string;
  cid: CID;
  size?: number;
  isTree?: boolean;
}

/**
 * HashTree - create, read, and edit merkle trees
 */
export class HashTree {
  private store: Store;
  private chunkSize: number;
  private maxLinks: number;

  constructor(config: HashTreeConfig) {
    this.store = config.store;
    this.chunkSize = config.chunkSize ?? DEFAULT_CHUNK_SIZE;
    this.maxLinks = config.maxLinks ?? DEFAULT_MAX_LINKS;
  }

  private get config(): create.CreateConfig {
    return { store: this.store, chunkSize: this.chunkSize, maxLinks: this.maxLinks };
  }

  // Create (encrypted by default)

  async putBlob(data: Uint8Array): Promise<Hash> {
    return create.putBlob(this.store, data);
  }

  /**
   * Store a file
   * @param data - File data to store
   * @param options - { public?: boolean } - if true, store without encryption
   * @returns { cid, size }
   */
  async putFile(
    data: Uint8Array,
    options?: { public?: boolean }
  ): Promise<{ cid: CID; size: number }> {
    if (options?.public) {
      const result = await create.putFile(this.config, data);
      return { cid: { hash: result.hash }, size: result.size };
    }
    const result = await putFileEncrypted(this.config, data);
    return { cid: cid(result.hash, result.key), size: result.size };
  }

  /**
   * Store a directory
   * @param entries - Directory entries
   * @param options - { public?: boolean, metadata?: Record } - if public true, store without encryption
   * @returns { cid, size }
   */
  async putDirectory(
    entries: DirEntry[],
    options?: { public?: boolean; metadata?: Record<string, unknown> }
  ): Promise<{ cid: CID; size: number }> {
    const size = entries.reduce((sum, e) => sum + (e.size ?? 0), 0);
    if (options?.public) {
      const dirEntries: create.DirEntry[] = entries.map(e => ({
        name: e.name,
        cid: e.cid,
        size: e.size ?? 0,
        isTree: e.isTree,
      }));
      const hash = await create.putDirectory(this.config, dirEntries, options.metadata);
      return { cid: { hash }, size };
    }
    // Encrypted by default
    const encryptedEntries: EncryptedDirEntry[] = entries.map(e => ({
      name: e.name,
      hash: e.cid.hash,
      size: e.size,
      key: e.cid.key,
      isTree: e.isTree,
    }));
    const result = await putDirectoryEncrypted(this.config, encryptedEntries, options?.metadata);
    return { cid: cid(result.hash, result.key), size };
  }

  // Read

  async getBlob(hash: Hash): Promise<Uint8Array | null> {
    return read.getBlob(this.store, hash);
  }

  /**
   * Get a tree node
   */
  async getTreeNode(id: CID): Promise<TreeNode | null> {
    if (id.key) {
      return getTreeNodeEncrypted(this.store, id.hash, id.key);
    }
    return read.getTreeNode(this.store, id.hash);
  }

  async isTree(id: CID): Promise<boolean> {
    if (!id?.hash) return false;
    return read.isTree(this.store, id.hash);
  }

  async isDirectory(id: CID): Promise<boolean> {
    if (!id?.hash) return false;
    // For encrypted directories, we need to decrypt to check the node type
    if (id.key) {
      try {
        // Try to get the tree node (will decrypt and validate)
        const node = await getTreeNodeEncrypted(this.store, id.hash, id.key);
        if (!node) return false;
        // Empty directory is still a directory
        if (node.links.length === 0) return true;
        // Check if it's a directory (has named entries) vs chunked file (no names)
        return node.links.some(l => l.name !== undefined && !l.name.startsWith('_'));
      } catch {
        return false;
      }
    }
    return read.isDirectory(this.store, id.hash);
  }

  /**
   * Read a file
   */
  async readFile(id: CID): Promise<Uint8Array | null> {
    if (id.key) {
      return readFileEncrypted(this.store, id.hash, id.key);
    }
    return read.readFile(this.store, id.hash);
  }

  /**
   * Stream a file, optionally starting from an offset
   */
  async *readFileStream(id: CID, offset: number = 0): AsyncGenerator<Uint8Array> {
    if (id.key) {
      yield* readFileEncryptedStream(this.store, id.hash, id.key, offset);
    } else {
      yield* read.readFileStream(this.store, id.hash, offset);
    }
  }

  /**
   * Read a range of bytes from a file
   */
  async readFileRange(id: CID, start: number, end?: number): Promise<Uint8Array | null> {
    if (id.key) {
      return readFileEncryptedRange(this.store, id.hash, id.key, start, end);
    }
    return read.readFileRange(this.store, id.hash, start, end);
  }

  /**
   * List directory entries
   */
  async listDirectory(id: CID): Promise<TreeEntry[]> {
    if (id.key) {
      const entries = await listDirectoryEncrypted(this.store, id.hash, id.key);
      return entries.map(e => ({
        name: e.name,
        cid: cid(e.hash, e.key),
        size: e.size,
        isTree: e.isTree ?? false,
      }));
    }
    const entries = await read.listDirectory(this.store, id.hash);
    return entries.map(e => ({
      name: e.name,
      cid: e.cid,
      size: e.size,
      isTree: e.isTree,
    }));
  }

  /**
   * Resolve a path to get the entry's CID
   *
   * @param root - Root CID of the tree
   * @param path - Path to resolve (string like 'a/b/file.txt' or array like ['a', 'b', 'file.txt'])
   * @returns { cid, isTree } or null if not found
   */
  async resolvePath(
    root: CID,
    path: string | string[]
  ): Promise<{ cid: CID; isTree: boolean } | null> {
    const parts = Array.isArray(path)
      ? path
      : path.split('/').filter(p => p.length > 0);

    let current = root;
    let isTree = true;

    for (const segment of parts) {
      const entries = await this.listDirectory(current);
      const entry = entries.find(e => e.name === segment);
      if (!entry) {
        return null;
      }

      current = entry.cid;
      isTree = entry.isTree;
    }

    return { cid: current, isTree };
  }

  async getSize(hash: Hash): Promise<number> {
    return read.getSize(this.store, hash);
  }

  async *walk(
    hash: Hash,
    path: string = ''
  ): AsyncGenerator<{ path: string; hash: Hash; isTree: boolean; size?: number }> {
    yield* read.walk(this.store, hash, path);
  }

  /**
   * Pull (fetch) all chunks for a tree recursively
   * Triggers WebRTC fetches for any missing chunks
   * @returns Stats about what was pulled
   */
  async pull(id: CID): Promise<{ chunks: number; bytes: number }> {
    const visited = new Set<string>();
    let chunks = 0;
    let bytes = 0;

    const fetch = async (hash: Hash, key?: Uint8Array): Promise<void> => {
      const hex = toHex(hash);
      if (visited.has(hex)) return;
      visited.add(hex);

      // Fetch the chunk (will go to WebRTC peers if not local)
      const data = await this.store.get(hash);
      if (!data) {
        return;
      }

      chunks++;
      bytes += data.length;

      // If there's an encryption key, try to decrypt and check if it's a tree node
      // For encrypted data, we can't use isTreeNode on the raw bytes
      if (key) {
        const decrypted = await getTreeNodeEncrypted(this.store, hash, key);
        if (decrypted) {
          // It's an encrypted tree node - recursively fetch children
          for (const link of decrypted.links) {
            await fetch(link.hash, link.key);
          }
        }
        // If decryption failed or not a tree node, it's a blob (already fetched)
      } else {
        // Unencrypted data - check directly
        if (isTreeNode(data)) {
          const node = decodeTreeNode(data);
          for (const link of node.links) {
            await fetch(link.hash, link.key);
          }
        }
        // If not a tree node, it's a blob (already fetched)
      }
    };

    await fetch(id.hash, id.key);
    return { chunks, bytes };
  }

  // Edit operations

  /**
   * Add or update an entry in a directory
   * @param root - Root CID of the tree
   * @param path - Path to the directory containing the entry
   * @param name - Name of the entry
   * @param entry - CID of the entry content
   * @param size - Size of the content
   * @param isTree - Whether the entry is a directory
   * @returns New root CID
   */
  async setEntry(
    root: CID,
    path: string[],
    name: string,
    entry: CID,
    size: number,
    isTree = false
  ): Promise<CID> {
    if (root.key) {
      const result = await editEncrypted.setEntryEncrypted(
        this.config,
        root.hash,
        root.key,
        path,
        name,
        entry.hash,
        size,
        entry.key,
        isTree
      );
      return cid(result.hash, result.key);
    }
    const hash = await edit.setEntry(this.config, root.hash, path, name, entry, size, isTree);
    return { hash };
  }

  /**
   * Remove an entry from a directory
   * @param root - Root CID of the tree
   * @param path - Path to the directory containing the entry
   * @param name - Name of the entry to remove
   * @returns New root CID
   */
  async removeEntry(root: CID, path: string[], name: string): Promise<CID> {
    if (root.key) {
      const result = await editEncrypted.removeEntryEncrypted(
        this.config,
        root.hash,
        root.key,
        path,
        name
      );
      return cid(result.hash, result.key);
    }
    const hash = await edit.removeEntry(this.config, root.hash, path, name);
    return { hash };
  }

  /**
   * Rename an entry in a directory
   * @param root - Root CID of the tree
   * @param path - Path to the directory containing the entry
   * @param oldName - Current name
   * @param newName - New name
   * @returns New root CID
   */
  async renameEntry(
    root: CID,
    path: string[],
    oldName: string,
    newName: string
  ): Promise<CID> {
    if (root.key) {
      const result = await editEncrypted.renameEntryEncrypted(
        this.config,
        root.hash,
        root.key,
        path,
        oldName,
        newName
      );
      return cid(result.hash, result.key);
    }
    const hash = await edit.renameEntry(this.config, root.hash, path, oldName, newName);
    return { hash };
  }

  /**
   * Move an entry to a different directory (public trees only)
   * @param root - Root CID of the tree
   * @param sourcePath - Path to the source directory
   * @param name - Name of the entry to move
   * @param targetPath - Path to the target directory
   * @returns New root CID
   */
  async moveEntry(
    root: CID,
    sourcePath: string[],
    name: string,
    targetPath: string[]
  ): Promise<CID> {
    if (root.key) {
      throw new Error('moveEntry not yet implemented for encrypted trees');
    }
    const hash = await edit.moveEntry(this.config, root.hash, sourcePath, name, targetPath);
    return { hash };
  }

  // Utility

  getStore(): Store {
    return this.store;
  }

  /**
   * Create a streaming file writer for incremental appends
   * Useful for writing large files chunk by chunk (e.g., video recording)
   * @param options - { public?: boolean } - if true, create without encryption
   */
  createStream(options?: { public?: boolean }): StreamWriter {
    return new StreamWriter(this.store, this.chunkSize, this.maxLinks, options?.public ?? false);
  }
}

/**
 * StreamWriter - supports incremental file appends
 *
 * Created via HashTree.createStream()
 *
 * All chunks are CHK encrypted by default (same as putFile).
 * Use createStream({ public: true }) for unencrypted streaming.
 */
export class StreamWriter {
  private store: Store;
  private chunkSize: number;
  private maxLinks: number;
  private isPublic: boolean;

  // Current partial chunk being built
  private buffer: Uint8Array;
  private bufferOffset: number = 0;

  // Completed chunks (with encryption keys for tree building when encrypted)
  private chunks: Link[] = [];
  private totalSize: number = 0;

  constructor(store: Store, chunkSize: number, maxLinks: number, isPublic: boolean = false) {
    this.store = store;
    this.chunkSize = chunkSize;
    this.maxLinks = maxLinks;
    this.isPublic = isPublic;
    this.buffer = new Uint8Array(this.chunkSize);
  }

  /**
   * Append data to the stream
   */
  async append(data: Uint8Array): Promise<void> {
    let offset = 0;

    while (offset < data.length) {
      const space = this.chunkSize - this.bufferOffset;
      const toWrite = Math.min(space, data.length - offset);

      this.buffer.set(data.slice(offset, offset + toWrite), this.bufferOffset);
      this.bufferOffset += toWrite;
      offset += toWrite;

      // Flush full chunk
      if (this.bufferOffset === this.chunkSize) {
        await this.flushChunk();
      }
    }

    this.totalSize += data.length;
  }

  /**
   * Flush current buffer as a chunk (encrypted or plaintext based on mode)
   */
  private async flushChunk(): Promise<void> {
    if (this.bufferOffset === 0) return;

    const chunk = this.buffer.slice(0, this.bufferOffset);

    if (this.isPublic) {
      // Public mode: store plaintext
      const hash = await sha256(chunk);
      await this.store.put(hash, chunk);
      this.chunks.push({ hash, size: chunk.length, isTree: false });
    } else {
      // Encrypted mode: CHK encrypt the chunk
      // Store PLAINTEXT size in link.size for correct range seeking
      const plaintextSize = chunk.length;
      const { ciphertext, key } = await encryptChk(chunk);
      const hash = await sha256(ciphertext);
      await this.store.put(hash, ciphertext);
      this.chunks.push({ hash, size: plaintextSize, key, isTree: false });
    }

    this.bufferOffset = 0;
  }

  /**
   * Get current root CID without finalizing
   * Useful for checkpoints (e.g., live streaming)
   * Returns CID with key for encrypted streams, CID without key for public streams
   */
  async currentRoot(): Promise<CID | null> {
    if (this.chunks.length === 0 && this.bufferOffset === 0) {
      return null;
    }

    // Temporarily store buffer without modifying state
    const tempChunks = [...this.chunks];
    if (this.bufferOffset > 0) {
      const chunk = this.buffer.slice(0, this.bufferOffset);

      if (this.isPublic) {
        const hash = await sha256(chunk);
        await this.store.put(hash, chunk);
        tempChunks.push({ hash, size: chunk.length, isTree: false });
      } else {
        // Store PLAINTEXT size in link.size for correct range seeking
        const plaintextSize = chunk.length;
        const { ciphertext, key } = await encryptChk(chunk);
        const hash = await sha256(ciphertext);
        await this.store.put(hash, ciphertext);
        tempChunks.push({ hash, size: plaintextSize, key, isTree: false });
      }
    }

    return this.buildTreeFromChunks(tempChunks, this.totalSize);
  }

  /**
   * Finalize the stream and return root CID
   * For encrypted streams: returns { hash, size, key }
   * For public streams: returns { hash, size } (key is undefined)
   */
  async finalize(): Promise<{ hash: Hash; size: number; key?: EncryptionKey }> {
    // Flush remaining buffer
    await this.flushChunk();

    if (this.chunks.length === 0) {
      // Empty stream
      if (this.isPublic) {
        const emptyData = new Uint8Array(0);
        const hash = await sha256(emptyData);
        await this.store.put(hash, emptyData);
        return { hash, size: 0 };
      } else {
        const { ciphertext, key } = await encryptChk(new Uint8Array(0));
        const hash = await sha256(ciphertext);
        await this.store.put(hash, ciphertext);
        return { hash, size: 0, key };
      }
    }

    const result = await this.buildTreeFromChunks(this.chunks, this.totalSize);
    return { hash: result.hash, size: this.totalSize, key: result.key };
  }

  /**
   * Build balanced tree from chunks
   */
  private async buildTreeFromChunks(chunks: Link[], totalSize: number): Promise<CID> {
    // Single chunk - return its hash (and key if encrypted)
    if (chunks.length === 1) {
      return cid(chunks[0].hash, chunks[0].key);
    }

    if (chunks.length <= this.maxLinks) {
      const node: TreeNode = {
        type: NodeType.Tree,
        links: chunks,
        totalSize,
      };
      const { data, hash: nodeHash } = await encodeAndHash(node);

      if (this.isPublic) {
        // Public mode: store plaintext tree node
        await this.store.put(nodeHash, data);
        return { hash: nodeHash };
      } else {
        // Encrypted mode: CHK encrypt the tree node
        const { ciphertext, key } = await encryptChk(data);
        const hash = await sha256(ciphertext);
        await this.store.put(hash, ciphertext);
        return cid(hash, key);
      }
    }

    // Build intermediate level
    const subTrees: Link[] = [];
    for (let i = 0; i < chunks.length; i += this.maxLinks) {
      const batch = chunks.slice(i, i + this.maxLinks);
      const batchSize = batch.reduce((sum, l) => sum + (l.size ?? 0), 0);

      const node: TreeNode = {
        type: NodeType.Tree,
        links: batch,
        totalSize: batchSize,
      };
      const { data, hash: nodeHash } = await encodeAndHash(node);

      if (this.isPublic) {
        await this.store.put(nodeHash, data);
        subTrees.push({ hash: nodeHash, size: batchSize, isTree: true });
      } else {
        const { ciphertext, key } = await encryptChk(data);
        const hash = await sha256(ciphertext);
        await this.store.put(hash, ciphertext);
        subTrees.push({ hash, size: batchSize, key, isTree: true });
      }
    }

    return this.buildTreeFromChunks(subTrees, totalSize);
  }

  /**
   * Get stats
   */
  get stats(): { chunks: number; buffered: number; totalSize: number } {
    return {
      chunks: this.chunks.length,
      buffered: this.bufferOffset,
      totalSize: this.totalSize,
    };
  }
}

/**
 * Verify tree integrity - checks that all referenced hashes exist
 */
export async function verifyTree(
  store: Store,
  rootHash: Hash
): Promise<{ valid: boolean; missing: Hash[] }> {
  const missing: Hash[] = [];
  const visited = new Set<string>();

  async function check(hash: Hash): Promise<void> {
    const hex = toHex(hash);
    if (visited.has(hex)) return;
    visited.add(hex);

    const data = await store.get(hash);
    if (!data) {
      missing.push(hash);
      return;
    }

    if (isTreeNode(data)) {
      const node = decodeTreeNode(data);
      for (const link of node.links) {
        await check(link.hash);
      }
    }
  }

  await check(rootHash);

  return { valid: missing.length === 0, missing };
}
