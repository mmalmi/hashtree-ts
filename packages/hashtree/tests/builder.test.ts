import { describe, it, expect, beforeEach } from 'vitest';
import { TreeBuilder, StreamBuilder, DEFAULT_CHUNK_SIZE, DEFAULT_MAX_LINKS } from '../src/builder.js';
import { TreeReader } from '../src/index.js';
import { MemoryStore } from '../src/store/memory.js';
import { toHex } from '../src/types.js';
import { sha256 } from '../src/hash.js';
import { decodeTreeNode } from '../src/codec.js';

describe('TreeBuilder', () => {
  let store: MemoryStore;
  let builder: TreeBuilder;
  let reader: TreeReader;

  beforeEach(() => {
    store = new MemoryStore();
    builder = new TreeBuilder({ store });
    reader = new TreeReader({ store });
  });

  describe('putBlob', () => {
    it('should store blob and return hash', async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const hash = await builder.putBlob(data);

      expect(hash.length).toBe(32);
      expect(await store.has(hash)).toBe(true);

      const retrieved = await store.get(hash);
      expect(retrieved).toEqual(data);
    });

    it('should compute correct hash', async () => {
      const data = new Uint8Array([1, 2, 3]);
      const hash = await builder.putBlob(data);
      const expectedHash = await sha256(data);

      expect(toHex(hash)).toBe(toHex(expectedHash));
    });
  });

  describe('putFile', () => {
    it('should store small file as single blob', async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const { hash, size } = await builder.putFile(data);

      expect(size).toBe(5);
      expect(await reader.readFile({ hash })).toEqual(data);
    });

    it('should chunk large files', async () => {
      // Create data larger than chunk size
      const chunkSize = 1024;
      const smallBuilder = new TreeBuilder({ store, chunkSize });

      const data = new Uint8Array(chunkSize * 2 + 100);
      for (let i = 0; i < data.length; i++) {
        data[i] = i % 256;
      }

      const { hash, size } = await smallBuilder.putFile(data);

      expect(size).toBe(data.length);

      // Should be a tree node, not raw blob
      const isTree = await reader.isTree({ hash });
      expect(isTree).toBe(true);

      // Should reassemble correctly
      const retrieved = await reader.readFile({ hash });
      expect(retrieved).toEqual(data);
    });

    it('should handle file exactly chunk size', async () => {
      const chunkSize = 256;
      const smallBuilder = new TreeBuilder({ store, chunkSize });

      const data = new Uint8Array(chunkSize);
      data.fill(42);

      const { hash, size } = await smallBuilder.putFile(data);

      expect(size).toBe(chunkSize);
      expect(await reader.readFile({ hash })).toEqual(data);
    });

    it('should create balanced tree for many chunks', async () => {
      const chunkSize = 100;
      const maxLinks = 4;
      const smallBuilder = new TreeBuilder({ store, chunkSize, maxLinks });

      // Create 10 chunks worth of data (will need multiple tree levels)
      const data = new Uint8Array(chunkSize * 10);
      for (let i = 0; i < data.length; i++) {
        data[i] = i % 256;
      }

      const { hash, size } = await smallBuilder.putFile(data);

      expect(size).toBe(data.length);
      expect(await reader.readFile({ hash })).toEqual(data);
    });
  });

  describe('putDirectory', () => {
    it('should create directory from entries', async () => {
      const file1 = new Uint8Array([1, 2, 3]);
      const file2 = new Uint8Array([4, 5, 6, 7]);

      const hash1 = await builder.putBlob(file1);
      const hash2 = await builder.putBlob(file2);

      const dirHash = await builder.putDirectory([
        { name: 'a.txt', hash: hash1, size: file1.length },
        { name: 'b.txt', hash: hash2, size: file2.length },
      ]);

      const entries = await reader.listDirectory({ hash: dirHash });
      expect(entries.length).toBe(2);
      expect(entries.find(e => e.name === 'a.txt')).toBeDefined();
      expect(entries.find(e => e.name === 'b.txt')).toBeDefined();
    });

    it('should sort entries by name', async () => {
      const hash = await builder.putBlob(new Uint8Array([1]));

      const dirHash = await builder.putDirectory([
        { name: 'zebra', hash },
        { name: 'apple', hash },
        { name: 'mango', hash },
      ]);

      const node = await reader.getTreeNode({ hash: dirHash });
      expect(node!.links.map(l => l.name)).toEqual(['apple', 'mango', 'zebra']);
    });

    it('should create nested directories', async () => {
      const fileData = new Uint8Array([1, 2, 3]);
      const fileHash = await builder.putBlob(fileData);

      const subDirHash = await builder.putDirectory([
        { name: 'file.txt', hash: fileHash, size: 3 },
      ]);

      const rootHash = await builder.putDirectory([
        { name: 'subdir', hash: subDirHash },
      ]);

      const resolved = await reader.resolvePath({ hash: rootHash }, 'subdir/file.txt');
      expect(resolved).not.toBeNull();
      expect(toHex(resolved!.cid.hash)).toBe(toHex(fileHash));
    });

    it('should split large directories', async () => {
      const maxLinks = 4;
      const smallBuilder = new TreeBuilder({ store, maxLinks });

      const entries = [];
      for (let i = 0; i < 10; i++) {
        const data = new Uint8Array([i]);
        const hash = await smallBuilder.putBlob(data);
        entries.push({ name: `file${i.toString().padStart(2, '0')}.txt`, hash, size: 1 });
      }

      const dirHash = await smallBuilder.putDirectory(entries);

      // Should be able to list all entries even though dir is split
      const listed = await reader.listDirectory({ hash: dirHash });
      expect(listed.length).toBe(10);
    });
  });

  describe('putTreeNode', () => {
    it('should create tree node with metadata', async () => {
      const hash = await builder.putBlob(new Uint8Array([1]));

      const nodeHash = await builder.putTreeNode(
        [{ hash, name: 'test', size: 1 }],
        { version: 2, created: '2024-01-01' }
      );

      const node = await reader.getTreeNode({ hash: nodeHash });
      expect(node!.metadata).toEqual({ version: 2, created: '2024-01-01' });
    });
  });
});

describe('StreamBuilder', () => {
  let store: MemoryStore;
  let reader: TreeReader;

  beforeEach(() => {
    store = new MemoryStore();
    reader = new TreeReader({ store });
  });

  describe('append', () => {
    it('should build file from multiple appends', async () => {
      const stream = new StreamBuilder({ store, chunkSize: 100 });

      await stream.append(new Uint8Array([1, 2, 3]));
      await stream.append(new Uint8Array([4, 5]));
      await stream.append(new Uint8Array([6, 7, 8, 9]));

      const { hash, size } = await stream.finalize();

      expect(size).toBe(9);
      const data = await reader.readFile({ hash });
      expect(data).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]));
    });

    it('should handle appends crossing chunk boundaries', async () => {
      const chunkSize = 10;
      const stream = new StreamBuilder({ store, chunkSize });

      // Append 25 bytes in various sizes
      await stream.append(new Uint8Array(7).fill(1));
      await stream.append(new Uint8Array(8).fill(2));
      await stream.append(new Uint8Array(10).fill(3));

      const { hash, size } = await stream.finalize();
      expect(size).toBe(25);

      const data = await reader.readFile({ hash });
      expect(data!.length).toBe(25);
      expect(data![0]).toBe(1);
      expect(data![7]).toBe(2);
      expect(data![15]).toBe(3);
    });

    it('should track stats', async () => {
      const stream = new StreamBuilder({ store, chunkSize: 100 });

      expect(stream.stats.chunks).toBe(0);
      expect(stream.stats.buffered).toBe(0);
      expect(stream.stats.totalSize).toBe(0);

      await stream.append(new Uint8Array(50));
      expect(stream.stats.buffered).toBe(50);
      expect(stream.stats.totalSize).toBe(50);

      await stream.append(new Uint8Array(60)); // Crosses boundary
      expect(stream.stats.chunks).toBe(1);
      expect(stream.stats.buffered).toBe(10);
      expect(stream.stats.totalSize).toBe(110);
    });
  });

  describe('currentRoot', () => {
    it('should return current root without finalizing', async () => {
      const stream = new StreamBuilder({ store, chunkSize: 100 });

      await stream.append(new Uint8Array([1, 2, 3]));
      const root1 = await stream.currentRoot();

      await stream.append(new Uint8Array([4, 5, 6]));
      const root2 = await stream.currentRoot();

      // Roots should be different
      expect(toHex(root1!)).not.toBe(toHex(root2!));

      // Can still finalize
      const { hash } = await stream.finalize();
      expect(hash.length).toBe(32);
    });

    it('should return null for empty stream', async () => {
      const stream = new StreamBuilder({ store });
      const root = await stream.currentRoot();
      expect(root).toBeNull();
    });
  });

  describe('finalize', () => {
    it('should handle empty stream', async () => {
      const stream = new StreamBuilder({ store });
      const { hash, size } = await stream.finalize();

      expect(size).toBe(0);
      const data = await reader.readFile({ hash });
      expect(data).toEqual(new Uint8Array(0));
    });

    it('should create balanced tree for large streams', async () => {
      const chunkSize = 100;
      const maxLinks = 4;
      const stream = new StreamBuilder({ store, chunkSize, maxLinks });

      // Add 20 chunks worth
      for (let i = 0; i < 20; i++) {
        const chunk = new Uint8Array(chunkSize);
        chunk.fill(i);
        await stream.append(chunk);
      }

      const { hash, size } = await stream.finalize();
      expect(size).toBe(2000);

      // Verify can read back
      const data = await reader.readFile({ hash });
      expect(data!.length).toBe(2000);
      expect(data![0]).toBe(0);
      expect(data![100]).toBe(1);
      expect(data![1900]).toBe(19);
    });
  });

  describe('directory metadata', () => {
    it('should store metadata on directory root', async () => {
      const builder = new TreeBuilder({ store });

      const fileHash = await builder.putBlob(new TextEncoder().encode('test'));
      const metadata = {
        createdAt: 1700000000,
        version: '1.0',
        author: 'test-user',
      };

      const dirHash = await builder.putDirectory(
        [{ name: 'file.txt', hash: fileHash, size: 4 }],
        metadata
      );

      // Read back the tree node and verify metadata
      const encoded = await store.get(dirHash);
      expect(encoded).not.toBeNull();

      const node = decodeTreeNode(encoded!);
      expect(node.metadata).toEqual(metadata);
      expect(node.metadata!.createdAt).toBe(1700000000);
      expect(node.metadata!.version).toBe('1.0');
    });

    it('should preserve metadata on large directories', async () => {
      const builder = new TreeBuilder({ store, maxLinks: 4 });

      // Create enough entries to trigger sub-tree creation
      const entries = [];
      for (let i = 0; i < 10; i++) {
        const hash = await builder.putBlob(new Uint8Array([i]));
        entries.push({ name: `file${i}.txt`, hash, size: 1 });
      }

      const metadata = { createdAt: 1700000000 };
      const dirHash = await builder.putDirectory(entries, metadata);

      // Read back root and verify metadata
      const encoded = await store.get(dirHash);
      const node = decodeTreeNode(encoded!);
      expect(node.metadata).toEqual(metadata);
    });
  });
});
