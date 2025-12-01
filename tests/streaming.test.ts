/**
 * Additional tests for streaming functionality
 * Inspired by scionic-merkle-tree-ts streaming tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { StreamBuilder } from '../src/builder.js';
import { TreeReader } from '../src/index.js';
import { MemoryStore } from '../src/store/memory.js';
import { toHex } from '../src/types.js';

describe('StreamBuilder - Streaming scenarios', () => {
  let store: MemoryStore;
  let reader: TreeReader;

  beforeEach(() => {
    store = new MemoryStore();
    reader = new TreeReader({ store });
  });

  describe('incremental root updates', () => {
    it('should provide updated root hash after each chunk', async () => {
      const stream = new StreamBuilder({ store, chunkSize: 100 });

      await stream.append(new Uint8Array([1, 2, 3]));
      const root1 = await stream.currentRoot();

      await stream.append(new Uint8Array([4, 5, 6]));
      const root2 = await stream.currentRoot();

      await stream.append(new Uint8Array([7, 8, 9]));
      const root3 = await stream.currentRoot();

      // Each addition should produce different root
      expect(toHex(root1!)).not.toBe(toHex(root2!));
      expect(toHex(root2!)).not.toBe(toHex(root3!));

      // All intermediate roots should be readable
      const data1 = await reader.readFile(root1!);
      expect(data1).toEqual(new Uint8Array([1, 2, 3]));

      const data2 = await reader.readFile(root2!);
      expect(data2).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6]));

      const data3 = await reader.readFile(root3!);
      expect(data3).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]));
    });

    it('should allow reading partial stream at any point', async () => {
      const stream = new StreamBuilder({ store, chunkSize: 100 });
      const checkpoints: Uint8Array[] = [];

      for (let i = 0; i < 5; i++) {
        const chunk = new Uint8Array(20).fill(i);
        await stream.append(chunk);
        const root = await stream.currentRoot();
        checkpoints.push(root!);
      }

      // Each checkpoint should be independently readable
      for (let i = 0; i < checkpoints.length; i++) {
        const data = await reader.readFile(checkpoints[i]);
        expect(data!.length).toBe((i + 1) * 20);
        expect(data![i * 20]).toBe(i);
      }
    });
  });

  describe('livestream simulation', () => {
    it('should simulate video stream chunking', async () => {
      // Simulate 1-second video chunks (~100KB each)
      const chunkSize = 64 * 1024; // 64KB internal chunks
      const stream = new StreamBuilder({ store, chunkSize });

      const videoChunks = [];
      const publishedRoots = [];

      // Simulate 5 seconds of video
      for (let second = 0; second < 5; second++) {
        // Each "second" of video is ~100KB
        const videoData = new Uint8Array(100 * 1024);
        for (let i = 0; i < videoData.length; i++) {
          videoData[i] = (second * 100 + i) % 256;
        }
        videoChunks.push(videoData);

        await stream.append(videoData);
        const root = await stream.currentRoot();
        publishedRoots.push(root!);
      }

      // Final root
      const { hash: finalRoot, size } = await stream.finalize();
      expect(size).toBe(5 * 100 * 1024);

      // Viewer joining at second 3 should be able to read data
      const partialData = await reader.readFile(publishedRoots[2]);
      expect(partialData!.length).toBe(3 * 100 * 1024);

      // Full stream should contain all data
      const fullData = await reader.readFile(finalRoot);
      expect(fullData!.length).toBe(5 * 100 * 1024);
    });

    it('should handle rapid sequential chunk additions', async () => {
      const stream = new StreamBuilder({ store, chunkSize: 1024 });

      // Simulate rapid data arrival (sequential - appends must be serialized)
      for (let i = 0; i < 50; i++) {
        const chunk = new Uint8Array(100).fill(i);
        await stream.append(chunk);
      }

      const { hash, size } = await stream.finalize();
      expect(size).toBe(5000);

      const data = await reader.readFile(hash);
      expect(data!.length).toBe(5000);
    });
  });

  describe('concurrent readers', () => {
    it('should support multiple readers at different positions', async () => {
      const stream = new StreamBuilder({ store, chunkSize: 100 });

      // Build stream
      for (let i = 0; i < 10; i++) {
        await stream.append(new Uint8Array(50).fill(i));
      }
      const { hash } = await stream.finalize();

      // Multiple readers can read independently
      const reader1 = new TreeReader({ store });
      const reader2 = new TreeReader({ store });

      const [data1, data2] = await Promise.all([
        reader1.readFile(hash),
        reader2.readFile(hash),
      ]);

      expect(data1).toEqual(data2);
      expect(data1!.length).toBe(500);
    });
  });

  describe('edge cases', () => {
    it('should handle single byte appends', async () => {
      const stream = new StreamBuilder({ store, chunkSize: 10 });

      for (let i = 0; i < 25; i++) {
        await stream.append(new Uint8Array([i]));
      }

      const { hash, size } = await stream.finalize();
      expect(size).toBe(25);

      const data = await reader.readFile(hash);
      expect(data!.length).toBe(25);
      for (let i = 0; i < 25; i++) {
        expect(data![i]).toBe(i);
      }
    });

    it('should handle chunk-aligned appends', async () => {
      const chunkSize = 100;
      const stream = new StreamBuilder({ store, chunkSize });

      // Append exactly chunk-sized data 5 times
      for (let i = 0; i < 5; i++) {
        await stream.append(new Uint8Array(chunkSize).fill(i));
      }

      expect(stream.stats.chunks).toBe(5);
      expect(stream.stats.buffered).toBe(0);
      expect(stream.stats.totalSize).toBe(500);

      const { hash } = await stream.finalize();
      const data = await reader.readFile(hash);
      expect(data!.length).toBe(500);
    });

    it('should handle very large single append', async () => {
      const chunkSize = 100;
      const stream = new StreamBuilder({ store, chunkSize });

      // Single large append (10 chunks worth)
      const bigData = new Uint8Array(chunkSize * 10);
      for (let i = 0; i < bigData.length; i++) {
        bigData[i] = i % 256;
      }

      await stream.append(bigData);

      expect(stream.stats.chunks).toBe(10);
      expect(stream.stats.totalSize).toBe(1000);

      const { hash } = await stream.finalize();
      const data = await reader.readFile(hash);
      expect(data).toEqual(bigData);
    });

    it('should handle mixed small and large appends', async () => {
      const chunkSize = 100;
      const stream = new StreamBuilder({ store, chunkSize });

      await stream.append(new Uint8Array([1, 2, 3])); // 3 bytes
      await stream.append(new Uint8Array(250).fill(4)); // 250 bytes (crosses chunks)
      await stream.append(new Uint8Array([5])); // 1 byte
      await stream.append(new Uint8Array(46).fill(6)); // 46 bytes

      const { hash, size } = await stream.finalize();
      expect(size).toBe(300);

      const data = await reader.readFile(hash);
      expect(data![0]).toBe(1);
      expect(data![3]).toBe(4);
      expect(data![253]).toBe(5);
      expect(data![254]).toBe(6);
    });
  });

  describe('live mode simulation (rolling window)', () => {
    it('should allow rebuilding from subset of chunks', async () => {
      const chunkSize = 100;
      const maxChunks = 3; // Keep only last 3 "seconds"

      // Simulate chunks arriving
      const allChunks: Uint8Array[] = [];
      for (let i = 0; i < 10; i++) {
        const chunk = new Uint8Array(chunkSize);
        chunk.fill(i);
        allChunks.push(chunk);
      }

      // Build "live" stream with only last N chunks
      const liveChunks = allChunks.slice(-maxChunks);
      const stream = new StreamBuilder({ store, chunkSize });

      for (const chunk of liveChunks) {
        await stream.append(chunk);
      }

      const { hash, size } = await stream.finalize();
      expect(size).toBe(maxChunks * chunkSize);

      const data = await reader.readFile(hash);
      // Should contain chunks 7, 8, 9
      expect(data![0]).toBe(7);
      expect(data![100]).toBe(8);
      expect(data![200]).toBe(9);
    });
  });

  describe('deduplication', () => {
    it('should deduplicate identical chunks', async () => {
      const chunkSize = 100;
      const stream = new StreamBuilder({ store, chunkSize });

      const repeatedData = new Uint8Array(chunkSize).fill(42);

      // Append same data 5 times
      for (let i = 0; i < 5; i++) {
        await stream.append(repeatedData);
      }

      const { hash, size } = await stream.finalize();
      expect(size).toBe(500);

      // Store should have fewer items due to dedup
      // (1 chunk blob + potentially some tree nodes)
      const storeSize = store.size;
      // With 5 identical chunks, we only store 1 unique chunk
      // plus tree structure (much less than 5 separate chunks)
      expect(storeSize).toBeLessThan(5);
    });
  });
});
