import { describe, it, expect } from 'vitest';
import { encodeTreeNode, decodeTreeNode, encodeAndHash, isTreeNode } from '../src/codec.js';
import { NodeType, TreeNode, toHex } from '../src/types.js';
import { sha256 } from '../src/hash.js';

describe('codec', () => {
  describe('encodeTreeNode / decodeTreeNode', () => {
    it('should encode and decode empty tree', () => {
      const node: TreeNode = {
        type: NodeType.Tree,
        links: [],
      };

      const encoded = encodeTreeNode(node);
      const decoded = decodeTreeNode(encoded);

      expect(decoded.type).toBe(NodeType.Tree);
      expect(decoded.links).toEqual([]);
    });

    it('should encode and decode tree with links', () => {
      const hash1 = new Uint8Array(32).fill(1);
      const hash2 = new Uint8Array(32).fill(2);

      const node: TreeNode = {
        type: NodeType.Tree,
        links: [
          { hash: hash1, name: 'file1.txt', size: 100 },
          { hash: hash2, name: 'dir', size: 500 },
        ],
      };

      const encoded = encodeTreeNode(node);
      const decoded = decodeTreeNode(encoded);

      expect(decoded.links.length).toBe(2);
      expect(decoded.links[0].name).toBe('file1.txt');
      expect(decoded.links[0].size).toBe(100);
      expect(toHex(decoded.links[0].hash)).toBe(toHex(hash1));
      expect(decoded.links[1].name).toBe('dir');
    });

    it('should preserve totalSize', () => {
      const node: TreeNode = {
        type: NodeType.Tree,
        links: [],
        totalSize: 12345,
      };

      const encoded = encodeTreeNode(node);
      const decoded = decodeTreeNode(encoded);

      expect(decoded.totalSize).toBe(12345);
    });

    it('should preserve metadata', () => {
      const node: TreeNode = {
        type: NodeType.Tree,
        links: [],
        metadata: { version: 1, author: 'test' },
      };

      const encoded = encodeTreeNode(node);
      const decoded = decodeTreeNode(encoded);

      expect(decoded.metadata).toEqual({ version: 1, author: 'test' });
    });

    it('should handle links without optional fields', () => {
      const hash = new Uint8Array(32).fill(42);

      const node: TreeNode = {
        type: NodeType.Tree,
        links: [{ hash }],
      };

      const encoded = encodeTreeNode(node);
      const decoded = decodeTreeNode(encoded);

      expect(decoded.links[0].name).toBeUndefined();
      expect(decoded.links[0].size).toBeUndefined();
      expect(toHex(decoded.links[0].hash)).toBe(toHex(hash));
    });
  });

  describe('encodeAndHash', () => {
    it('should compute hash of encoded data', async () => {
      const node: TreeNode = {
        type: NodeType.Tree,
        links: [],
      };

      const { data, hash } = await encodeAndHash(node);
      const expectedHash = await sha256(data);

      expect(toHex(hash)).toBe(toHex(expectedHash));
    });

    it('should produce consistent hashes', async () => {
      const node: TreeNode = {
        type: NodeType.Tree,
        links: [{ hash: new Uint8Array(32).fill(1), name: 'test' }],
      };

      const result1 = await encodeAndHash(node);
      const result2 = await encodeAndHash(node);

      expect(toHex(result1.hash)).toBe(toHex(result2.hash));
    });
  });

  describe('isTreeNode', () => {
    it('should detect tree nodes', () => {
      const node: TreeNode = {
        type: NodeType.Tree,
        links: [],
      };

      const encoded = encodeTreeNode(node);
      expect(isTreeNode(encoded)).toBe(true);
    });

    it('should return false for raw blobs', () => {
      const blob = new Uint8Array([1, 2, 3, 4, 5]);
      expect(isTreeNode(blob)).toBe(false);
    });

    it('should return false for invalid CBOR', () => {
      const invalid = new Uint8Array([255, 255, 255]);
      expect(isTreeNode(invalid)).toBe(false);
    });

    it('should return false for non-tree CBOR objects', () => {
      // This would be valid CBOR but not a tree node
      const notTree = new TextEncoder().encode('hello');
      expect(isTreeNode(notTree)).toBe(false);
    });
  });
});
