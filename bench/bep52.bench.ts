/**
 * TreeBuilder Benchmark
 *
 * Tests different configurations:
 * - Chunk size: 256KB vs 16KB
 * - Hashing: Sequential vs Parallel
 * - Store: MemoryStore vs MockIDB (batched vs unbatched)
 *
 * Run with: npx tsx bench/bep52.bench.ts
 */

import { TreeBuilder, DEFAULT_CHUNK_SIZE, BEP52_CHUNK_SIZE } from '../packages/hashtree/src/builder.js';
import { TreeReader } from '../packages/hashtree/src/reader.js';
import { MemoryStore } from '../packages/hashtree/src/store/memory.js';
import { Store, Hash, toHex } from '../packages/hashtree/src/types.js';

/**
 * Mock IndexedDB store - unbatched (one transaction per put)
 */
class MockIDBStoreUnbatched implements Store {
  private data = new Map<string, Uint8Array>();
  private latencyMs: number;

  constructor(latencyMs: number = 1) {
    this.latencyMs = latencyMs;
  }

  private async delay(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, this.latencyMs));
  }

  async put(hash: Hash, data: Uint8Array): Promise<boolean> {
    await this.delay(); // Transaction overhead per put
    const key = toHex(hash);
    const isNew = !this.data.has(key);
    this.data.set(key, new Uint8Array(data));
    return isNew;
  }

  async get(hash: Hash): Promise<Uint8Array | null> {
    await this.delay();
    return this.data.get(toHex(hash)) ?? null;
  }

  async has(hash: Hash): Promise<boolean> {
    return this.data.has(toHex(hash));
  }

  async delete(hash: Hash): Promise<boolean> {
    return this.data.delete(toHex(hash));
  }
}

/**
 * Mock IndexedDB store - batched (buffers writes, single transaction per batch)
 */
class MockIDBStoreBatched implements Store {
  private data = new Map<string, Uint8Array>();
  private pending = new Map<string, Uint8Array>();
  private latencyMs: number;
  private batchSize: number;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(latencyMs: number = 1, batchSize: number = 100) {
    this.latencyMs = latencyMs;
    this.batchSize = batchSize;
  }

  async put(hash: Hash, data: Uint8Array): Promise<boolean> {
    const key = toHex(hash);
    if (this.pending.has(key) || this.data.has(key)) return false;

    this.pending.set(key, new Uint8Array(data));

    if (this.pending.size >= this.batchSize) {
      await this.flush();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flush();
      }, 1);
    }

    return true;
  }

  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.pending.size === 0) return;

    // Single transaction for all pending writes
    await new Promise(resolve => setTimeout(resolve, this.latencyMs));

    for (const [key, data] of this.pending) {
      this.data.set(key, data);
    }
    this.pending.clear();
  }

  async get(hash: Hash): Promise<Uint8Array | null> {
    await this.flush(); // Ensure pending writes are visible
    return this.data.get(toHex(hash)) ?? null;
  }

  async has(hash: Hash): Promise<boolean> {
    const key = toHex(hash);
    return this.pending.has(key) || this.data.has(key);
  }

  async delete(hash: Hash): Promise<boolean> {
    return this.data.delete(toHex(hash));
  }
}

interface BenchConfig {
  chunkSize: number;
  parallel: boolean;
}

interface BenchResult {
  name: string;
  writeMs: number;
  readMs: number;
  writeMBps: number;
  readMBps: number;
}

async function benchmark(
  name: string,
  store: Store,
  data: Uint8Array,
  config: BenchConfig,
  iterations: number = 3
): Promise<BenchResult> {
  const writeTimes: number[] = [];
  const readTimes: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const builder = new TreeBuilder({
      store,
      chunkSize: config.chunkSize,
      parallel: config.parallel,
    });

    // Write
    const writeStart = performance.now();
    const result = await builder.putFile(data);
    const writeEnd = performance.now();
    writeTimes.push(writeEnd - writeStart);

    // Read
    const reader = new TreeReader({ store });
    const readStart = performance.now();
    const readData = await reader.readFile(result.hash);
    const readEnd = performance.now();
    readTimes.push(readEnd - readStart);

    if (!readData || readData.length !== data.length) {
      throw new Error('Read verification failed');
    }
  }

  const avgWrite = writeTimes.reduce((a, b) => a + b, 0) / writeTimes.length;
  const avgRead = readTimes.reduce((a, b) => a + b, 0) / readTimes.length;
  const sizeMB = data.length / 1024 / 1024;

  return {
    name,
    writeMs: avgWrite,
    readMs: avgRead,
    writeMBps: sizeMB / (avgWrite / 1000),
    readMBps: sizeMB / (avgRead / 1000),
  };
}

async function main() {
  console.log('TreeBuilder Benchmark');
  console.log('=====================\n');

  // Test data sizes
  const sizes = [
    { name: '1 MB', size: 1 * 1024 * 1024 },
    { name: '10 MB', size: 10 * 1024 * 1024 },
  ];

  // Configurations to test
  const configs: { name: string; config: BenchConfig }[] = [
    { name: '256KB seq', config: { chunkSize: DEFAULT_CHUNK_SIZE, parallel: false } },
    { name: '256KB par', config: { chunkSize: DEFAULT_CHUNK_SIZE, parallel: true } },
    { name: '16KB seq', config: { chunkSize: BEP52_CHUNK_SIZE, parallel: false } },
    { name: '16KB par', config: { chunkSize: BEP52_CHUNK_SIZE, parallel: true } },
  ];

  // Run benchmarks with MemoryStore
  console.log('MemoryStore Benchmarks');
  console.log('----------------------');

  for (const { name: sizeName, size } of sizes) {
    console.log(`\n${sizeName}:`);
    const data = new Uint8Array(size);
    crypto.getRandomValues(data);

    for (const { name, config } of configs) {
      const store = new MemoryStore();
      const result = await benchmark(name, store, data, config);
      console.log(`  ${result.name.padEnd(12)} Write: ${result.writeMs.toFixed(1).padStart(6)}ms (${result.writeMBps.toFixed(1).padStart(6)} MB/s)  Read: ${result.readMs.toFixed(1).padStart(6)}ms (${result.readMBps.toFixed(1).padStart(6)} MB/s)`);
    }
  }

  // Run IDB simulation benchmarks
  console.log('\n\nMock IndexedDB Benchmarks (1ms latency)');
  console.log('---------------------------------------');

  const idbData = new Uint8Array(1 * 1024 * 1024); // 1 MB for IDB tests
  crypto.getRandomValues(idbData);

  for (const chunkSize of [DEFAULT_CHUNK_SIZE, BEP52_CHUNK_SIZE]) {
    const chunkName = chunkSize === DEFAULT_CHUNK_SIZE ? '256KB' : '16KB';
    console.log(`\n${chunkName} chunks:`);

    // Unbatched
    const unbatchedStore = new MockIDBStoreUnbatched(1);
    const unbatchedBuilder = new TreeBuilder({
      store: unbatchedStore,
      chunkSize,
      parallel: true,
    });
    const unbatchedStart = performance.now();
    await unbatchedBuilder.putFile(idbData);
    const unbatchedTime = performance.now() - unbatchedStart;
    const unbatchedThroughput = (idbData.length / 1024 / 1024) / (unbatchedTime / 1000);

    // Batched
    const batchedStore = new MockIDBStoreBatched(1, 100);
    const batchedBuilder = new TreeBuilder({
      store: batchedStore,
      chunkSize,
      parallel: true,
    });
    const batchedStart = performance.now();
    await batchedBuilder.putFile(idbData);
    await batchedStore.flush();
    const batchedTime = performance.now() - batchedStart;
    const batchedThroughput = (idbData.length / 1024 / 1024) / (batchedTime / 1000);

    console.log(`  Unbatched: ${unbatchedTime.toFixed(1).padStart(6)}ms (${unbatchedThroughput.toFixed(1).padStart(6)} MB/s)`);
    console.log(`  Batched:   ${batchedTime.toFixed(1).padStart(6)}ms (${batchedThroughput.toFixed(1).padStart(6)} MB/s)`);
  }

  console.log('\n\nSummary');
  console.log('-------');
  console.log('- 256KB chunks: Fewer blocks, faster with slow stores (IndexedDB)');
  console.log('- 16KB chunks: More blocks, useful for fine-grained deduplication');
  console.log('- Parallel hashing: Faster for CPU-bound operations');
  console.log('- Batched writes: Critical for IndexedDB performance');
}

main().catch(console.error);
