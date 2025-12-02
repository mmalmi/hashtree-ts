import { describe, it, expect, beforeEach } from 'vitest';
import { HashTree, MemoryStore, toHex } from '../src/index.js';

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
      const { hash, size } = await tree.putFile(data);

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
      const { hash, size } = await smallTree.putFile(data);

      expect(size).toBe(data.length);

      // Should be retrievable
      const retrieved = await smallTree.readFile(hash);
      expect(retrieved).toEqual(data);
    });

    it('should create empty directory', async () => {
      const hash = await tree.putDirectory([]);

      const entries = await tree.listDirectory(hash);
      expect(entries).toHaveLength(0);
    });

    it('should create directory with entries', async () => {
      const { hash: file1 } = await tree.putFile(new TextEncoder().encode('content1'));
      const { hash: file2 } = await tree.putFile(new TextEncoder().encode('content2'));

      const dirHash = await tree.putDirectory([
        { name: 'a.txt', hash: file1, size: 8 },
        { name: 'b.txt', hash: file2, size: 8 },
      ]);

      const entries = await tree.listDirectory(dirHash);
      expect(entries).toHaveLength(2);
      expect(entries.map(e => e.name).sort()).toEqual(['a.txt', 'b.txt']);
    });
  });

  describe('read', () => {
    it('should read file', async () => {
      const data = new TextEncoder().encode('test content');
      const { hash } = await tree.putFile(data);

      const result = await tree.readFile(hash);
      expect(result).toEqual(data);
    });

    it('should list directory', async () => {
      const { hash: fileHash } = await tree.putFile(new TextEncoder().encode('data'));
      const dirHash = await tree.putDirectory([{ name: 'file.txt', hash: fileHash, size: 4 }]);

      const entries = await tree.listDirectory(dirHash);
      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('file.txt');
    });

    it('should resolve path', async () => {
      const { hash: fileHash } = await tree.putFile(new TextEncoder().encode('nested'));
      const subDirHash = await tree.putDirectory([{ name: 'file.txt', hash: fileHash, size: 6 }]);
      const rootHash = await tree.putDirectory([{ name: 'subdir', hash: subDirHash, size: 6 }]);

      const resolved = await tree.resolvePath(rootHash, 'subdir/file.txt');
      expect(resolved).not.toBeNull();
      expect(toHex(resolved!)).toBe(toHex(fileHash));
    });

    it('should check if hash is directory', async () => {
      const { hash: fileHash } = await tree.putFile(new TextEncoder().encode('data'));
      const dirHash = await tree.putDirectory([]);

      expect(await tree.isDirectory(fileHash)).toBe(false);
      expect(await tree.isDirectory(dirHash)).toBe(true);
    });

    it('should stream file', async () => {
      const smallTree = new HashTree({ store, chunkSize: 5 });
      const data = new TextEncoder().encode('hello world!');
      const { hash } = await smallTree.putFile(data);

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
      const rootHash = await tree.putDirectory([]);
      const { hash: fileHash, size } = await tree.putFile(new TextEncoder().encode('hello'));

      const newRoot = await tree.setEntry(rootHash, [], 'test.txt', fileHash, size);

      const entries = await tree.listDirectory(newRoot);
      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('test.txt');
    });

    it('should update existing entry', async () => {
      const { hash: file1 } = await tree.putFile(new TextEncoder().encode('v1'));
      const rootHash = await tree.putDirectory([{ name: 'file.txt', hash: file1, size: 2 }]);

      const { hash: file2, size } = await tree.putFile(new TextEncoder().encode('v2 updated'));
      const newRoot = await tree.setEntry(rootHash, [], 'file.txt', file2, size);

      const entries = await tree.listDirectory(newRoot);
      expect(entries).toHaveLength(1);
      expect(toHex(entries[0].hash)).toBe(toHex(file2));
    });

    it('should remove entry', async () => {
      const { hash: file1 } = await tree.putFile(new TextEncoder().encode('a'));
      const { hash: file2 } = await tree.putFile(new TextEncoder().encode('b'));
      const rootHash = await tree.putDirectory([
        { name: 'a.txt', hash: file1, size: 1 },
        { name: 'b.txt', hash: file2, size: 1 },
      ]);

      const newRoot = await tree.removeEntry(rootHash, [], 'a.txt');

      const entries = await tree.listDirectory(newRoot);
      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('b.txt');
    });

    it('should rename entry', async () => {
      const { hash: fileHash } = await tree.putFile(new TextEncoder().encode('content'));
      const rootHash = await tree.putDirectory([{ name: 'old.txt', hash: fileHash, size: 7 }]);

      const newRoot = await tree.renameEntry(rootHash, [], 'old.txt', 'new.txt');

      const entries = await tree.listDirectory(newRoot);
      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('new.txt');
      expect(toHex(entries[0].hash)).toBe(toHex(fileHash));
    });

    it('should move entry between directories', async () => {
      const { hash: fileHash } = await tree.putFile(new TextEncoder().encode('content'));
      const dir1Hash = await tree.putDirectory([{ name: 'file.txt', hash: fileHash, size: 7 }]);
      const dir2Hash = await tree.putDirectory([]);
      const rootHash = await tree.putDirectory([
        { name: 'dir1', hash: dir1Hash, size: 7 },
        { name: 'dir2', hash: dir2Hash, size: 0 },
      ]);

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
      const cHash = await tree.putDirectory([]);
      const bHash = await tree.putDirectory([{ name: 'c', hash: cHash, size: 0 }]);
      const aHash = await tree.putDirectory([{ name: 'b', hash: bHash, size: 0 }]);
      const rootHash = await tree.putDirectory([{ name: 'a', hash: aHash, size: 0 }]);

      const { hash: fileHash, size } = await tree.putFile(new TextEncoder().encode('deep'));
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
});
