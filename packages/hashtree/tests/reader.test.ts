import { describe, it, expect, beforeEach } from 'vitest';
import { TreeReader, verifyTree } from '../src/index.js';
import { TreeBuilder } from '../src/builder.js';
import { MemoryStore } from '../src/store/memory.js';
import { toHex, NodeType, TreeNode } from '../src/types.js';
import { sha256 } from '../src/hash.js';
import { encodeAndHash } from '../src/codec.js';

describe('TreeReader', () => {
  let store: MemoryStore;
  let builder: TreeBuilder;
  let reader: TreeReader;

  beforeEach(() => {
    store = new MemoryStore();
    builder = new TreeBuilder({ store, chunkSize: 100 });
    reader = new TreeReader({ store });
  });

  describe('getBlob', () => {
    it('should return blob data', async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const hash = await builder.putBlob(data);

      const result = await reader.getBlob(hash);
      expect(result).toEqual(data);
    });

    it('should return null for non-existent hash', async () => {
      const hash = new Uint8Array(32).fill(0);
      const result = await reader.getBlob(hash);
      expect(result).toBeNull();
    });
  });

  describe('getTreeNode', () => {
    it('should return decoded tree node', async () => {
      const fileHash = await builder.putBlob(new Uint8Array([1]));
      const dirHash = await builder.putDirectory([
        { name: 'test.txt', hash: fileHash, size: 1 },
      ]);

      const node = await reader.getTreeNode({ hash: dirHash });
      expect(node).not.toBeNull();
      expect(node!.type).toBe(NodeType.Tree);
      expect(node!.links.length).toBe(1);
    });

    it('should return null for blob hash', async () => {
      const hash = await builder.putBlob(new Uint8Array([1, 2, 3]));
      const node = await reader.getTreeNode({ hash });
      expect(node).toBeNull();
    });
  });

  describe('isTree', () => {
    it('should return true for tree nodes', async () => {
      const fileHash = await builder.putBlob(new Uint8Array([1]));
      const dirHash = await builder.putDirectory([
        { name: 'test.txt', hash: fileHash },
      ]);

      expect(await reader.isTree({ hash: dirHash })).toBe(true);
    });

    it('should return false for blobs', async () => {
      const hash = await builder.putBlob(new Uint8Array([1, 2, 3]));
      expect(await reader.isTree({ hash })).toBe(false);
    });
  });

  describe('readFile', () => {
    it('should read small file directly', async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const { hash } = await builder.putFile(data);

      const result = await reader.readFile({ hash });
      expect(result).toEqual(data);
    });

    it('should reassemble chunked file', async () => {
      const data = new Uint8Array(350); // More than 3 chunks
      for (let i = 0; i < data.length; i++) {
        data[i] = i % 256;
      }

      const { hash } = await builder.putFile(data);
      const result = await reader.readFile({ hash });

      expect(result).toEqual(data);
    });

    it('should return null for non-existent hash', async () => {
      const hash = new Uint8Array(32).fill(0);
      const result = await reader.readFile({ hash });
      expect(result).toBeNull();
    });
  });

  describe('readFileStream', () => {
    it('should stream file chunks', async () => {
      const data = new Uint8Array(350);
      for (let i = 0; i < data.length; i++) {
        data[i] = i % 256;
      }

      const { hash } = await builder.putFile(data);

      const chunks: Uint8Array[] = [];
      for await (const chunk of reader.readFileStream({ hash })) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(1);

      // Concatenate and verify
      const total = chunks.reduce((sum, c) => sum + c.length, 0);
      expect(total).toBe(350);
    });

    it('should handle empty iteration for non-existent hash', async () => {
      const hash = new Uint8Array(32).fill(0);
      const chunks: Uint8Array[] = [];

      for await (const chunk of reader.readFileStream({ hash })) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBe(0);
    });
  });

  describe('listDirectory', () => {
    it('should list directory entries', async () => {
      const h1 = await builder.putBlob(new Uint8Array([1]));
      const h2 = await builder.putBlob(new Uint8Array([2]));

      const dirHash = await builder.putDirectory([
        { name: 'first.txt', hash: h1, size: 1 },
        { name: 'second.txt', hash: h2, size: 1 },
      ]);

      const entries = await reader.listDirectory({ hash: dirHash });

      expect(entries.length).toBe(2);
      expect(entries.find(e => e.name === 'first.txt')).toBeDefined();
      expect(entries.find(e => e.name === 'second.txt')).toBeDefined();
    });

    it('should indicate which entries are trees', async () => {
      const fileHash = await builder.putBlob(new Uint8Array([1]));
      const subDirHash = await builder.putDirectory([
        { name: 'sub.txt', hash: fileHash },
      ]);

      const rootHash = await builder.putDirectory([
        { name: 'file.txt', hash: fileHash },
        { name: 'subdir', hash: subDirHash },
      ]);

      const entries = await reader.listDirectory({ hash: rootHash });

      const fileEntry = entries.find(e => e.name === 'file.txt');
      const dirEntry = entries.find(e => e.name === 'subdir');

      expect(fileEntry!.isTree).toBe(false);
      expect(dirEntry!.isTree).toBe(true);
    });

    it('should flatten internal chunk nodes', async () => {
      const smallBuilder = new TreeBuilder({ store, maxLinks: 3 });

      const entries = [];
      for (let i = 0; i < 10; i++) {
        const hash = await smallBuilder.putBlob(new Uint8Array([i]));
        entries.push({ name: `file${i}.txt`, hash, size: 1 });
      }

      const dirHash = await smallBuilder.putDirectory(entries);
      const listed = await reader.listDirectory({ hash: dirHash });

      // Should see all 10 files, not the internal chunk nodes
      expect(listed.length).toBe(10);
      expect(listed.every(e => e.name.startsWith('file'))).toBe(true);
    });
  });

  describe('resolvePath', () => {
    it('should resolve simple path', async () => {
      const fileData = new Uint8Array([1, 2, 3]);
      const fileHash = await builder.putBlob(fileData);

      const dirHash = await builder.putDirectory([
        { name: 'test.txt', hash: fileHash },
      ]);

      const resolved = await reader.resolvePath({ hash: dirHash }, 'test.txt');
      expect(toHex(resolved!.cid.hash)).toBe(toHex(fileHash));
    });

    it('should resolve nested path', async () => {
      const fileHash = await builder.putBlob(new Uint8Array([1]));

      const subSubDir = await builder.putDirectory([
        { name: 'deep.txt', hash: fileHash },
      ]);

      const subDir = await builder.putDirectory([
        { name: 'level2', hash: subSubDir },
      ]);

      const rootDir = await builder.putDirectory([
        { name: 'level1', hash: subDir },
      ]);

      const resolved = await reader.resolvePath({ hash: rootDir }, 'level1/level2/deep.txt');
      expect(resolved).not.toBeNull();
      expect(toHex(resolved!.cid.hash)).toBe(toHex(fileHash));
    });

    it('should return null for non-existent path', async () => {
      const dirHash = await builder.putDirectory([]);
      const resolved = await reader.resolvePath({ hash: dirHash }, 'missing.txt');
      expect(resolved).toBeNull();
    });

    it('should handle leading/trailing slashes', async () => {
      const fileHash = await builder.putBlob(new Uint8Array([1]));
      const dirHash = await builder.putDirectory([
        { name: 'test.txt', hash: fileHash },
      ]);

      expect(await reader.resolvePath({ hash: dirHash }, '/test.txt')).not.toBeNull();
      expect(await reader.resolvePath({ hash: dirHash }, 'test.txt/')).not.toBeNull();
      expect(await reader.resolvePath({ hash: dirHash }, '/test.txt/')).not.toBeNull();
    });
  });

  describe('getSize', () => {
    it('should return blob size', async () => {
      const data = new Uint8Array(123);
      const hash = await builder.putBlob(data);

      expect(await reader.getSize(hash)).toBe(123);
    });

    it('should return tree totalSize', async () => {
      const data = new Uint8Array(350);
      const { hash } = await builder.putFile(data);

      expect(await reader.getSize(hash)).toBe(350);
    });
  });

  describe('walk', () => {
    it('should walk entire tree', async () => {
      const f1 = await builder.putBlob(new Uint8Array([1]));
      const f2 = await builder.putBlob(new Uint8Array([2, 3]));

      const subDir = await builder.putDirectory([
        { name: 'nested.txt', hash: f2, size: 2 },
      ]);

      const rootDir = await builder.putDirectory([
        { name: 'root.txt', hash: f1, size: 1 },
        { name: 'sub', hash: subDir },
      ]);

      const walked: string[] = [];
      for await (const entry of reader.walk(rootDir)) {
        walked.push(entry.path);
      }

      expect(walked).toContain('');
      expect(walked).toContain('root.txt');
      expect(walked).toContain('sub');
      expect(walked).toContain('sub/nested.txt');
    });
  });
});

describe('verifyTree', () => {
  let store: MemoryStore;
  let builder: TreeBuilder;

  beforeEach(() => {
    store = new MemoryStore();
    builder = new TreeBuilder({ store, chunkSize: 100 });
  });

  it('should return valid for complete tree', async () => {
    const data = new Uint8Array(350);
    const { hash } = await builder.putFile(data);

    const result = await verifyTree(store, hash);
    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it('should detect missing chunks', async () => {
    const data = new Uint8Array(350);
    const { hash } = await builder.putFile(data);

    // Delete one of the chunks
    const keys = store.keys();
    const chunkToDelete = keys.find(k => toHex(k) !== toHex(hash));
    if (chunkToDelete) {
      await store.delete(chunkToDelete);
    }

    const result = await verifyTree(store, hash);
    expect(result.valid).toBe(false);
    expect(result.missing.length).toBeGreaterThan(0);
  });

  it('should handle single blob', async () => {
    const hash = await builder.putBlob(new Uint8Array([1, 2, 3]));

    const result = await verifyTree(store, hash);
    expect(result.valid).toBe(true);
  });
});
