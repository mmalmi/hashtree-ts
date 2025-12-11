/**
 * Tree builder with chunking and fanout support
 *
 * - Large files are split into chunks
 * - Large directories are split into sub-trees
 * - Supports streaming appends
 */

import { Store, Hash, TreeNode, Link, LinkType } from './types.js';
import { sha256 } from './hash.js';
import { encodeAndHash } from './codec.js';

/**
 * Default chunk size: 256KB
 */
export const DEFAULT_CHUNK_SIZE = 256 * 1024;

/**
 * BEP52 chunk size: 16KB
 */
export const BEP52_CHUNK_SIZE = 16 * 1024;

/**
 * Default max links per tree node (fanout)
 */
export const DEFAULT_MAX_LINKS = 174;

export interface BuilderConfig {
  store: Store;
  /** Chunk size for splitting blobs */
  chunkSize?: number;
  /** Max links per tree node */
  maxLinks?: number;
  /** Hash chunks in parallel (default: true) */
  parallel?: boolean;
}

export interface FileEntry {
  name: string;
  data: Uint8Array;
}

export interface DirEntry {
  name: string;
  hash: Hash;
  size?: number;
  type: LinkType;
}

/**
 * TreeBuilder - builds content-addressed merkle trees
 */
export class TreeBuilder {
  private store: Store;
  private chunkSize: number;
  private maxLinks: number;
  private parallel: boolean;

  constructor(config: BuilderConfig) {
    this.store = config.store;
    this.chunkSize = config.chunkSize ?? DEFAULT_CHUNK_SIZE;
    this.maxLinks = config.maxLinks ?? DEFAULT_MAX_LINKS;
    this.parallel = config.parallel ?? true;
  }

  /**
   * Store a blob directly (small data)
   * Returns the content hash
   */
  async putBlob(data: Uint8Array): Promise<Hash> {
    const hash = await sha256(data);
    await this.store.put(hash, data);
    return hash;
  }

  /**
   * Store a file, chunking if necessary
   * Returns root hash and total size
   */
  async putFile(data: Uint8Array): Promise<{ hash: Hash; size: number }> {
    const size = data.length;

    // Small file - store as single blob
    if (data.length <= this.chunkSize) {
      const hash = await this.putBlob(data);
      return { hash, size };
    }

    // Split into chunks
    const chunkList: Uint8Array[] = [];
    let offset = 0;
    while (offset < data.length) {
      const end = Math.min(offset + this.chunkSize, data.length);
      chunkList.push(data.slice(offset, end));
      offset = end;
    }

    // Hash and store chunks (parallel or sequential)
    let chunkHashes: Hash[];
    if (this.parallel) {
      chunkHashes = await Promise.all(chunkList.map(chunk => this.putBlob(chunk)));
    } else {
      chunkHashes = [];
      for (const chunk of chunkList) {
        chunkHashes.push(await this.putBlob(chunk));
      }
    }

    // Build tree from chunks (leaf chunks are raw blobs)
    const chunks: Link[] = chunkHashes.map((hash, i) => ({
      hash,
      size: i < chunkHashes.length - 1 ? this.chunkSize : data.length - i * this.chunkSize,
      type: LinkType.Blob,
    }));
    const rootHash = await this.buildTree(chunks, size);
    return { hash: rootHash, size };
  }

  /**
   * Build a balanced tree from links (for chunked files)
   * Handles fanout by creating intermediate nodes
   */
  private async buildTree(links: Link[], totalSize?: number): Promise<Hash> {
    // Single link - return it directly
    if (links.length === 1 && links[0].size === totalSize) {
      return links[0].hash;
    }

    // Fits in one node
    if (links.length <= this.maxLinks) {
      const node: TreeNode = {
        type: LinkType.File,
        links,
        totalSize,
      };
      const { data, hash } = await encodeAndHash(node);
      await this.store.put(hash, data);
      return hash;
    }

    // Need to split into sub-trees
    const subTrees: Link[] = [];

    for (let i = 0; i < links.length; i += this.maxLinks) {
      const batch = links.slice(i, i + this.maxLinks);
      const batchSize = batch.reduce((sum, l) => sum + (l.size ?? 0), 0);

      const node: TreeNode = {
        type: LinkType.File,
        links: batch,
        totalSize: batchSize,
      };
      const { data, hash } = await encodeAndHash(node);
      await this.store.put(hash, data);

      subTrees.push({ hash, size: batchSize, type: LinkType.File });
    }

    // Recursively build parent level
    return this.buildTree(subTrees, totalSize);
  }

  /**
   * Build a directory from entries
   * Entries can be files or subdirectories
   *
   * Directories are encoded as MessagePack blobs. If the encoded blob exceeds
   * chunkSize, it's chunked by bytes like files using putFile.
   *
   * @param entries Directory entries
   * @param metadata Optional metadata for root node (timestamp, etc.)
   */
  async putDirectory(entries: DirEntry[], metadata?: Record<string, unknown>): Promise<Hash> {
    // Sort entries by name for deterministic hashing
    const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));

    const links: Link[] = sorted.map(e => ({
      hash: e.hash,
      name: e.name,
      size: e.size,
      type: e.type,
    }));

    const totalSize = links.reduce((sum, l) => sum + (l.size ?? 0), 0);

    const node: TreeNode = {
      type: LinkType.Dir,
      links,
      totalSize,
      metadata,
    };
    const { data, hash } = await encodeAndHash(node);

    // Small directory - store directly
    if (data.length <= this.chunkSize) {
      await this.store.put(hash, data);
      return hash;
    }

    // Large directory - reuse putFile for chunking
    const { hash: rootHash } = await this.putFile(data);
    return rootHash;
  }

  /**
   * Create a tree node with custom metadata
   * @param nodeType - LinkType.File or LinkType.Dir
   */
  async putTreeNode(
    nodeType: LinkType.File | LinkType.Dir,
    links: Link[],
    metadata?: Record<string, unknown>
  ): Promise<Hash> {
    const totalSize = links.reduce((sum, l) => sum + (l.size ?? 0), 0);

    const node: TreeNode = {
      type: nodeType,
      links,
      totalSize,
      metadata,
    };

    const { data, hash } = await encodeAndHash(node);
    await this.store.put(hash, data);
    return hash;
  }
}

/**
 * StreamBuilder - supports incremental appends
 */
export class StreamBuilder {
  private store: Store;
  private chunkSize: number;
  private maxLinks: number;

  // Current partial chunk being built
  private buffer: Uint8Array;
  private bufferOffset: number = 0;

  // Completed chunks
  private chunks: Link[] = [];
  private totalSize: number = 0;

  constructor(config: BuilderConfig) {
    this.store = config.store;
    this.chunkSize = config.chunkSize ?? DEFAULT_CHUNK_SIZE;
    this.maxLinks = config.maxLinks ?? DEFAULT_MAX_LINKS;
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
   * Flush current buffer as a chunk
   */
  private async flushChunk(): Promise<void> {
    if (this.bufferOffset === 0) return;

    const chunk = this.buffer.slice(0, this.bufferOffset);
    const hash = await sha256(chunk);
    await this.store.put(hash, new Uint8Array(chunk));

    this.chunks.push({ hash, size: chunk.length, type: LinkType.Blob });
    this.bufferOffset = 0;
  }

  /**
   * Get current root hash without finalizing
   * Useful for checkpoints
   */
  async currentRoot(): Promise<Hash | null> {
    if (this.chunks.length === 0 && this.bufferOffset === 0) {
      return null;
    }

    // Temporarily flush buffer
    const tempChunks = [...this.chunks];
    if (this.bufferOffset > 0) {
      const chunk = this.buffer.slice(0, this.bufferOffset);
      const hash = await sha256(chunk);
      await this.store.put(hash, new Uint8Array(chunk));
      tempChunks.push({ hash, size: chunk.length, type: LinkType.Blob });
    }

    return this.buildTreeFromChunks(tempChunks, this.totalSize);
  }

  /**
   * Finalize the stream and return root hash
   */
  async finalize(): Promise<{ hash: Hash; size: number }> {
    // Flush remaining buffer
    await this.flushChunk();

    if (this.chunks.length === 0) {
      // Empty stream - return hash of empty data
      const emptyHash = await sha256(new Uint8Array(0));
      await this.store.put(emptyHash, new Uint8Array(0));
      return { hash: emptyHash, size: 0 };
    }

    const hash = await this.buildTreeFromChunks(this.chunks, this.totalSize);
    return { hash, size: this.totalSize };
  }

  /**
   * Build balanced tree from chunks (for streaming files)
   */
  private async buildTreeFromChunks(chunks: Link[], totalSize: number): Promise<Hash> {
    if (chunks.length === 1) {
      return chunks[0].hash;
    }

    if (chunks.length <= this.maxLinks) {
      const node: TreeNode = {
        type: LinkType.File,
        links: chunks,
        totalSize,
      };
      const { data, hash } = await encodeAndHash(node);
      await this.store.put(hash, data);
      return hash;
    }

    // Build intermediate level
    const subTrees: Link[] = [];
    for (let i = 0; i < chunks.length; i += this.maxLinks) {
      const batch = chunks.slice(i, i + this.maxLinks);
      const batchSize = batch.reduce((sum, l) => sum + (l.size ?? 0), 0);

      const node: TreeNode = {
        type: LinkType.File,
        links: batch,
        totalSize: batchSize,
      };
      const { data, hash } = await encodeAndHash(node);
      await this.store.put(hash, data);

      subTrees.push({ hash, size: batchSize, type: LinkType.File });
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

