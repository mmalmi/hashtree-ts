/**
 * StreamWriter - supports incremental file appends
 *
 * Created via HashTree.createStream()
 *
 * All chunks are CHK encrypted by default (same as putFile).
 * Use createStream({ public: true }) for unencrypted streaming.
 */

import { Store, Hash, CID, TreeNode, LinkType, Link, cid } from './types.js';
import { encodeAndHash } from './codec.js';
import { sha256 } from './hash.js';
import { encryptChk, type EncryptionKey } from './crypto.js';

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
      this.chunks.push({ hash, size: chunk.length, type: LinkType.Blob });
    } else {
      // Encrypted mode: CHK encrypt the chunk
      // Store PLAINTEXT size in link.size for correct range seeking
      const plaintextSize = chunk.length;
      const { ciphertext, key } = await encryptChk(chunk);
      const hash = await sha256(ciphertext);
      await this.store.put(hash, ciphertext);
      this.chunks.push({ hash, size: plaintextSize, key, type: LinkType.Blob });
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
        tempChunks.push({ hash, size: chunk.length, type: LinkType.Blob });
      } else {
        // Store PLAINTEXT size in link.size for correct range seeking
        const plaintextSize = chunk.length;
        const { ciphertext, key } = await encryptChk(chunk);
        const hash = await sha256(ciphertext);
        await this.store.put(hash, ciphertext);
        tempChunks.push({ hash, size: plaintextSize, key, type: LinkType.Blob });
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
        type: LinkType.File,
        links: chunks,
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
      const batchSize = batch.reduce((sum, l) => sum + l.size, 0);

      const node: TreeNode = {
        type: LinkType.File,
        links: batch,
      };
      const { data, hash: nodeHash } = await encodeAndHash(node);

      if (this.isPublic) {
        await this.store.put(nodeHash, data);
        subTrees.push({ hash: nodeHash, size: batchSize, type: LinkType.File });
      } else {
        const { ciphertext, key } = await encryptChk(data);
        const hash = await sha256(ciphertext);
        await this.store.put(hash, ciphertext);
        subTrees.push({ hash, size: batchSize, key, type: LinkType.File });
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
