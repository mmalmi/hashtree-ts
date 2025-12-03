import { describe, it, expect, beforeEach } from 'vitest';
import { HashTree, MemoryStore, toHex, type EncryptionKey } from '../src/index.js';

describe('HashTree', () => {
  let store: MemoryStore;
  let tree: HashTree;

  beforeEach(() => {
    store = new MemoryStore();
    tree = new HashTree({ store });
  });

  describe('create', () => {
    it('should store small file as single blob', async () => {
      const data = new TextEncoder().encode('hello world');
      const { hash, size } = await tree.putFile(data, { public: true });

      expect(size).toBe(11);
      expect(hash).toBeInstanceOf(Uint8Array);
      expect(hash.length).toBe(32);

      // Should be retrievable
      const retrieved = await tree.readFile(hash);
      expect(retrieved).toEqual(data);
    });

    it('should chunk large files', async () => {
      const smallTree = new HashTree({ store, chunkSize: 10 });
      const data = new TextEncoder().encode('this is a longer message that will be chunked');
      const { hash, size } = await smallTree.putFile(data, { public: true });

      expect(size).toBe(data.length);

      // Should be retrievable
      const retrieved = await smallTree.readFile(hash);
      expect(retrieved).toEqual(data);
    });

    it('should create empty directory', async () => {
      const { hash } = await tree.putDirectory([], { public: true });

      const entries = await tree.listDirectory(hash);
      expect(entries).toHaveLength(0);
    });

    it('should create directory with entries', async () => {
      const { hash: file1 } = await tree.putFile(new TextEncoder().encode('content1'), { public: true });
      const { hash: file2 } = await tree.putFile(new TextEncoder().encode('content2'), { public: true });

      const { hash: dirHash } = await tree.putDirectory([
        { name: 'a.txt', hash: file1, size: 8 },
        { name: 'b.txt', hash: file2, size: 8 },
      ], { public: true });

      const entries = await tree.listDirectory(dirHash);
      expect(entries).toHaveLength(2);
      expect(entries.map(e => e.name).sort()).toEqual(['a.txt', 'b.txt']);
    });
  });

  describe('read', () => {
    it('should read file', async () => {
      const data = new TextEncoder().encode('test content');
      const { hash } = await tree.putFile(data, { public: true });

      const result = await tree.readFile(hash);
      expect(result).toEqual(data);
    });

    it('should list directory', async () => {
      const { hash: fileHash } = await tree.putFile(new TextEncoder().encode('data'), { public: true });
      const { hash: dirHash } = await tree.putDirectory([{ name: 'file.txt', hash: fileHash, size: 4 }], { public: true });

      const entries = await tree.listDirectory(dirHash);
      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('file.txt');
    });

    it('should resolve path', async () => {
      const { hash: fileHash } = await tree.putFile(new TextEncoder().encode('nested'), { public: true });
      const { hash: subDirHash } = await tree.putDirectory([{ name: 'file.txt', hash: fileHash, size: 6 }], { public: true });
      const { hash: rootHash } = await tree.putDirectory([{ name: 'subdir', hash: subDirHash, size: 6 }], { public: true });

      const resolved = await tree.resolvePath(rootHash, 'subdir/file.txt');
      expect(resolved).not.toBeNull();
      expect(toHex(resolved!)).toBe(toHex(fileHash));
    });

    it('should check if hash is directory', async () => {
      const { hash: fileHash } = await tree.putFile(new TextEncoder().encode('data'), { public: true });
      const { hash: dirHash } = await tree.putDirectory([], { public: true });

      expect(await tree.isDirectory(fileHash)).toBe(false);
      expect(await tree.isDirectory(dirHash)).toBe(true);
    });

    it('should stream file', async () => {
      const smallTree = new HashTree({ store, chunkSize: 5 });
      const data = new TextEncoder().encode('hello world!');
      const { hash } = await smallTree.putFile(data, { public: true });

      const chunks: Uint8Array[] = [];
      for await (const chunk of smallTree.readFileStream(hash)) {
        chunks.push(chunk);
      }

      const combined = new Uint8Array(chunks.reduce((sum, c) => sum + c.length, 0));
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }

      expect(combined).toEqual(data);
    });
  });

  describe('edit', () => {
    it('should add entry to directory', async () => {
      const { hash: rootHash } = await tree.putDirectory([], { public: true });
      const { hash: fileHash, size } = await tree.putFile(new TextEncoder().encode('hello'), { public: true });

      const newRoot = await tree.setEntry(rootHash, [], 'test.txt', fileHash, size);

      const entries = await tree.listDirectory(newRoot);
      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('test.txt');
    });

    it('should update existing entry', async () => {
      const { hash: file1 } = await tree.putFile(new TextEncoder().encode('v1'), { public: true });
      const { hash: rootHash } = await tree.putDirectory([{ name: 'file.txt', hash: file1, size: 2 }], { public: true });

      const { hash: file2, size } = await tree.putFile(new TextEncoder().encode('v2 updated'), { public: true });
      const newRoot = await tree.setEntry(rootHash, [], 'file.txt', file2, size);

      const entries = await tree.listDirectory(newRoot);
      expect(entries).toHaveLength(1);
      expect(toHex(entries[0].hash)).toBe(toHex(file2));
    });

    it('should remove entry', async () => {
      const { hash: file1 } = await tree.putFile(new TextEncoder().encode('a'), { public: true });
      const { hash: file2 } = await tree.putFile(new TextEncoder().encode('b'), { public: true });
      const { hash: rootHash } = await tree.putDirectory([
        { name: 'a.txt', hash: file1, size: 1 },
        { name: 'b.txt', hash: file2, size: 1 },
      ], { public: true });

      const newRoot = await tree.removeEntry(rootHash, [], 'a.txt');

      const entries = await tree.listDirectory(newRoot);
      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('b.txt');
    });

    it('should rename entry', async () => {
      const { hash: fileHash } = await tree.putFile(new TextEncoder().encode('content'), { public: true });
      const { hash: rootHash } = await tree.putDirectory([{ name: 'old.txt', hash: fileHash, size: 7 }], { public: true });

      const newRoot = await tree.renameEntry(rootHash, [], 'old.txt', 'new.txt');

      const entries = await tree.listDirectory(newRoot);
      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('new.txt');
      expect(toHex(entries[0].hash)).toBe(toHex(fileHash));
    });

    it('should move entry between directories', async () => {
      const { hash: fileHash } = await tree.putFile(new TextEncoder().encode('content'), { public: true });
      const { hash: dir1Hash } = await tree.putDirectory([{ name: 'file.txt', hash: fileHash, size: 7 }], { public: true });
      const { hash: dir2Hash } = await tree.putDirectory([], { public: true });
      const { hash: rootHash } = await tree.putDirectory([
        { name: 'dir1', hash: dir1Hash, size: 7 },
        { name: 'dir2', hash: dir2Hash, size: 0 },
      ], { public: true });

      const newRoot = await tree.moveEntry(rootHash, ['dir1'], 'file.txt', ['dir2']);

      expect(await tree.listDirectory(newRoot)).toHaveLength(2);

      const dir1Entries = await tree.listDirectory(
        (await tree.resolvePath(newRoot, 'dir1'))!
      );
      expect(dir1Entries).toHaveLength(0);

      const dir2Entries = await tree.listDirectory(
        (await tree.resolvePath(newRoot, 'dir2'))!
      );
      expect(dir2Entries).toHaveLength(1);
      expect(dir2Entries[0].name).toBe('file.txt');
    });

    it('should handle nested path edits', async () => {
      const { hash: cHash } = await tree.putDirectory([], { public: true });
      const { hash: bHash } = await tree.putDirectory([{ name: 'c', hash: cHash, size: 0 }], { public: true });
      const { hash: aHash } = await tree.putDirectory([{ name: 'b', hash: bHash, size: 0 }], { public: true });
      const { hash: rootHash } = await tree.putDirectory([{ name: 'a', hash: aHash, size: 0 }], { public: true });

      const { hash: fileHash, size } = await tree.putFile(new TextEncoder().encode('deep'), { public: true });
      const newRoot = await tree.setEntry(rootHash, ['a', 'b', 'c'], 'file.txt', fileHash, size);

      // Verify nested file
      const entries = await tree.listDirectory(
        (await tree.resolvePath(newRoot, 'a/b/c'))!
      );
      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('file.txt');

      // Verify parent structure intact
      const aEntries = await tree.listDirectory(
        (await tree.resolvePath(newRoot, 'a'))!
      );
      expect(aEntries).toHaveLength(1);
      expect(aEntries[0].name).toBe('b');
    });
  });

  describe('encrypted (default)', () => {
    it('should encrypt file by default', async () => {
      const data = new TextEncoder().encode('secret content');
      const { hash, size, key } = await tree.putFile(data);

      expect(key).toBeDefined();
      expect(key!.length).toBe(32);
      expect(size).toBe(14);

      // Should be retrievable with key
      const retrieved = await tree.readFile(hash, key);
      expect(retrieved).toEqual(data);

      // Should NOT be readable without key (returns encrypted data or null)
      const withoutKey = await tree.readFile(hash);
      expect(withoutKey).not.toEqual(data);
    });

    it('should encrypt directory by default', async () => {
      const { hash: fileHash, key: fileKey } = await tree.putFile(new TextEncoder().encode('data'));
      const { hash: dirHash, key: dirKey } = await tree.putDirectory([
        { name: 'file.txt', hash: fileHash, size: 4, key: fileKey },
      ]);

      expect(dirKey).toBeDefined();
      expect(dirKey!.length).toBe(32);

      // Should list with key
      const entries = await tree.listDirectory(dirHash, dirKey);
      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('file.txt');
      expect(entries[0].key).toBeDefined();
    });

    it('should preserve isTree flag in encrypted directory', async () => {
      // Create an encrypted subdirectory
      const { hash: subDirHash, key: subDirKey } = await tree.putDirectory([]);

      // Create root directory with subdirectory entry
      const { hash: rootHash, key: rootKey } = await tree.putDirectory([
        { name: 'subdir', hash: subDirHash, size: 0, key: subDirKey, isTree: true },
      ]);

      // List root and check isTree
      const entries = await tree.listDirectory(rootHash, rootKey);
      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('subdir');
      expect(entries[0].isTree).toBe(true);
      expect(entries[0].key).toBeDefined();
    });

    it('should preserve isTree=false for files in encrypted directory', async () => {
      const { hash: fileHash, key: fileKey } = await tree.putFile(new TextEncoder().encode('data'));
      const { hash: dirHash, key: dirKey } = await tree.putDirectory([
        { name: 'file.txt', hash: fileHash, size: 4, key: fileKey, isTree: false },
      ]);

      const entries = await tree.listDirectory(dirHash, dirKey);
      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('file.txt');
      expect(entries[0].isTree).toBe(false);
    });

    it('should add entry to encrypted directory with setEntryEncrypted', async () => {
      const { hash: rootHash, key: rootKey } = await tree.putDirectory([]);
      const { hash: fileHash, size, key: fileKey } = await tree.putFile(new TextEncoder().encode('hello'));

      const { hash: newRoot, key: newKey } = await tree.setEntryEncrypted(
        rootHash,
        rootKey!,
        [],
        'test.txt',
        fileHash,
        size,
        fileKey,
        false
      );

      const entries = await tree.listDirectory(newRoot, newKey);
      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('test.txt');
      expect(entries[0].isTree).toBe(false);
    });

    it('should add subdirectory to encrypted directory with setEntryEncrypted', async () => {
      const { hash: rootHash, key: rootKey } = await tree.putDirectory([]);
      const { hash: subDirHash, key: subDirKey, size } = await tree.putDirectory([]);

      const { hash: newRoot, key: newKey } = await tree.setEntryEncrypted(
        rootHash,
        rootKey!,
        [],
        'subdir',
        subDirHash,
        size,
        subDirKey,
        true  // isTree = true
      );

      const entries = await tree.listDirectory(newRoot, newKey);
      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('subdir');
      expect(entries[0].isTree).toBe(true);
    });

    it('should handle nested encrypted directories', async () => {
      // Create nested structure: root/a/b/file.txt
      const { hash: fileHash, key: fileKey } = await tree.putFile(new TextEncoder().encode('nested'));

      const { hash: bHash, key: bKey } = await tree.putDirectory([
        { name: 'file.txt', hash: fileHash, size: 6, key: fileKey, isTree: false },
      ]);

      const { hash: aHash, key: aKey } = await tree.putDirectory([
        { name: 'b', hash: bHash, size: 6, key: bKey, isTree: true },
      ]);

      const { hash: rootHash, key: rootKey } = await tree.putDirectory([
        { name: 'a', hash: aHash, size: 6, key: aKey, isTree: true },
      ]);

      // Navigate to root/a
      const rootEntries = await tree.listDirectory(rootHash, rootKey);
      expect(rootEntries[0].name).toBe('a');
      expect(rootEntries[0].isTree).toBe(true);

      // Navigate to root/a/b
      const aEntries = await tree.listDirectory(rootEntries[0].hash, rootEntries[0].key);
      expect(aEntries[0].name).toBe('b');
      expect(aEntries[0].isTree).toBe(true);

      // Navigate to root/a/b/file.txt
      const bEntries = await tree.listDirectory(aEntries[0].hash, aEntries[0].key);
      expect(bEntries[0].name).toBe('file.txt');
      expect(bEntries[0].isTree).toBe(false);

      // Read the file
      const content = await tree.readFile(bEntries[0].hash, bEntries[0].key);
      expect(content).toEqual(new TextEncoder().encode('nested'));
    });
  });
});
