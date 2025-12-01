/**
 * Comprehensive TreeBuilder Benchmark
 *
 * Tests all combinations of:
 * - Chunk size: 256KB vs 16KB
 * - Merkle algorithm: CBOR vs Binary
 * - Hashing: Sequential vs Parallel
 * - Store: MemoryStore vs MockIDB (batched vs unbatched)
 *
 * Run with: npx tsx bench/bep52.bench.ts
 */

import { TreeBuilder, DEFAULT_CHUNK_SIZE, BEP52_CHUNK_SIZE, MerkleAlgorithm } from '../src/builder.js';
import { TreeReader } from '../src/reader.js';
import { MemoryStore } from '../src/store/memory.js';
import { Store, Hash, toHex } from '../src/types.js';

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
    const key = toHex(hash);
    return this.pending.get(key) ?? this.data.get(key) ?? null;
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
  merkleAlgorithm: MerkleAlgorithm;
  parallel: boolean;
}

interface WriteReadResult {
  name: string;
  size: number;
  writeMs: number;
  readMs: number;
  writeThroughput: number;
  readThroughput: number;
  blockCount: number;
}

async function benchmarkWriteRead(
  name: string,
  data: Uint8Array,
  config: BenchConfig,
  iterations: number = 3,
): Promise<WriteReadResult> {
  const writeTimes: number[] = [];
  const readTimes: number[] = [];
  let blockCount = 0;

  for (let i = 0; i < iterations; i++) {
    const store = new MemoryStore();
    const builder = new TreeBuilder({
      store,
      chunkSize: config.chunkSize,
      merkleAlgorithm: config.merkleAlgorithm,
      parallel: config.parallel,
    });

    // Write
    const writeStart = performance.now();
    const result = await builder.putFile(data);
    const writeEnd = performance.now();
    writeTimes.push(writeEnd - writeStart);
    blockCount = result.leafHashes?.length ?? 0;

    // Read
    if (config.merkleAlgorithm === 'cbor') {
      const reader = new TreeReader({ store });
      const readStart = performance.now();
      const readData = await reader.readFile(result.hash);
      const readEnd = performance.now();
      readTimes.push(readEnd - readStart);

      if (!readData || readData.length !== data.length) {
        throw new Error('Read verification failed');
      }
    } else {
      // Binary: read leaf hashes directly
      const readStart = performance.now();
      const parts: Uint8Array[] = [];
      for (const leafHash of result.leafHashes!) {
        const block = await store.get(leafHash);
        if (block) parts.push(block);
      }
      const totalLen = parts.reduce((sum, p) => sum + p.length, 0);
      const readData = new Uint8Array(totalLen);
      let offset = 0;
      for (const part of parts) {
        readData.set(part, offset);
        offset += part.length;
      }
      const readEnd = performance.now();
      readTimes.push(readEnd - readStart);

      if (readData.length !== data.length) {
        throw new Error('Read verification failed');
      }
    }
  }

  const avgWrite = writeTimes.reduce((a, b) => a + b, 0) / writeTimes.length;
  const avgRead = readTimes.reduce((a, b) => a + b, 0) / readTimes.length;
  const sizeMB = data.length / 1024 / 1024;

  return {
    name,
    size: data.length,
    writeMs: avgWrite,
    readMs: avgRead,
    writeThroughput: sizeMB / (avgWrite / 1000),
    readThroughput: sizeMB / (avgRead / 1000),
    blockCount,
  };
}

function formatResult(r: WriteReadResult): string {
  const sizeMB = (r.size / 1024 / 1024).toFixed(0);
  return `${r.name.padEnd(32)} | W: ${r.writeMs.toFixed(1).padStart(7)}ms (${r.writeThroughput.toFixed(0).padStart(5)} MB/s) | R: ${r.readMs.toFixed(1).padStart(7)}ms (${r.readThroughput.toFixed(0).padStart(5)} MB/s) | ${r.blockCount.toString().padStart(5)} blks`;
}

async function main() {
  console.log('TreeBuilder Comprehensive Benchmark');
  console.log('='.repeat(100));
  console.log();
  console.log('Configurations:');
  console.log('  Chunk sizes: 256KB (default), 16KB (BEP52)');
  console.log('  Algorithms:  CBOR (tree nodes), Binary (hash pairs)');
  console.log('  Hashing:     Sequential (seq), Parallel (par)');
  console.log();

  const configs: { name: string; config: BenchConfig }[] = [
    // 256KB configurations
    { name: '256KB CBOR seq', config: { chunkSize: DEFAULT_CHUNK_SIZE, merkleAlgorithm: 'cbor', parallel: false } },
    { name: '256KB CBOR par', config: { chunkSize: DEFAULT_CHUNK_SIZE, merkleAlgorithm: 'cbor', parallel: true } },
    { name: '256KB Binary seq', config: { chunkSize: DEFAULT_CHUNK_SIZE, merkleAlgorithm: 'binary', parallel: false } },
    { name: '256KB Binary par', config: { chunkSize: DEFAULT_CHUNK_SIZE, merkleAlgorithm: 'binary', parallel: true } },
    // 16KB configurations
    { name: '16KB CBOR seq', config: { chunkSize: BEP52_CHUNK_SIZE, merkleAlgorithm: 'cbor', parallel: false } },
    { name: '16KB CBOR par', config: { chunkSize: BEP52_CHUNK_SIZE, merkleAlgorithm: 'cbor', parallel: true } },
    { name: '16KB Binary seq', config: { chunkSize: BEP52_CHUNK_SIZE, merkleAlgorithm: 'binary', parallel: false } },
    { name: '16KB Binary par', config: { chunkSize: BEP52_CHUNK_SIZE, merkleAlgorithm: 'binary', parallel: true } },
  ];

  const sizes = [
    { name: '1 MB', bytes: 1 * 1024 * 1024 },
    { name: '10 MB', bytes: 10 * 1024 * 1024 },
    { name: '50 MB', bytes: 50 * 1024 * 1024 },
  ];

  for (const size of sizes) {
    console.log(`\n${size.name} Write + Read:`);
    console.log('-'.repeat(100));

    const data = new Uint8Array(size.bytes);
    for (let i = 0; i < data.length; i++) data[i] = i % 256;

    const results: WriteReadResult[] = [];
    for (const { name, config } of configs) {
      const result = await benchmarkWriteRead(name, data, config, 3);
      results.push(result);
      console.log(formatResult(result));
    }

    // Summary for this size
    const best256Write = results.slice(0, 4).reduce((a, b) => a.writeThroughput > b.writeThroughput ? a : b);
    const best16Write = results.slice(4, 8).reduce((a, b) => a.writeThroughput > b.writeThroughput ? a : b);
    const best256Read = results.slice(0, 4).reduce((a, b) => a.readThroughput > b.readThroughput ? a : b);
    const best16Read = results.slice(4, 8).reduce((a, b) => a.readThroughput > b.readThroughput ? a : b);

    console.log();
    console.log(`  Best 256KB write: ${best256Write.name} (${best256Write.writeThroughput.toFixed(0)} MB/s)`);
    console.log(`  Best 256KB read:  ${best256Read.name} (${best256Read.readThroughput.toFixed(0)} MB/s)`);
    console.log(`  Best 16KB write:  ${best16Write.name} (${best16Write.writeThroughput.toFixed(0)} MB/s)`);
    console.log(`  Best 16KB read:   ${best16Read.name} (${best16Read.readThroughput.toFixed(0)} MB/s)`);
  }

  // IDB batching comparison
  console.log();
  console.log('='.repeat(100));
  console.log();
  console.log('MockIDB Batching Comparison (1ms transaction latency):');
  console.log('-'.repeat(100));

  const idbData = new Uint8Array(1 * 1024 * 1024); // 1 MB
  for (let i = 0; i < idbData.length; i++) idbData[i] = i % 256;

  const idbConfigs = [
    { name: '256KB', chunkSize: DEFAULT_CHUNK_SIZE },
    { name: '16KB', chunkSize: BEP52_CHUNK_SIZE },
  ];

  for (const { name, chunkSize } of idbConfigs) {
    const blockCount = Math.ceil(idbData.length / chunkSize);

    // Unbatched
    const unbatchedStore = new MockIDBStoreUnbatched(1);
    const unbatchedBuilder = new TreeBuilder({
      store: unbatchedStore,
      chunkSize,
      merkleAlgorithm: 'cbor',
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
      merkleAlgorithm: 'cbor',
      parallel: true,
    });
    const batchedStart = performance.now();
    await batchedBuilder.putFile(idbData);
    await batchedStore.flush();
    const batchedTime = performance.now() - batchedStart;
    const batchedThroughput = (idbData.length / 1024 / 1024) / (batchedTime / 1000);

    const speedup = unbatchedTime / batchedTime;
    console.log(`${name} unbatched: ${unbatchedTime.toFixed(1)}ms (${unbatchedThroughput.toFixed(0)} MB/s) - ${blockCount} transactions`);
    console.log(`${name} batched:   ${batchedTime.toFixed(1)}ms (${batchedThroughput.toFixed(0)} MB/s) - ${Math.ceil(blockCount / 100)} transactions`);
    console.log(`  -> Batching is ${speedup.toFixed(1)}x faster`);
    console.log();
  }

  console.log('='.repeat(100));
  console.log();
  console.log('Notes:');
  console.log('- CBOR: Variable fanout tree nodes, supports TreeReader for traversal');
  console.log('- Binary: BEP52-style power-of-2 padded merkle tree, no intermediate nodes stored');
  console.log('- Parallel hashing fires all sha256 calls at once via Promise.all');
  console.log('- 16KB chunks = 16x more blocks than 256KB');
  console.log('- IDB batching reduces transaction overhead by combining writes');
}

main().catch(console.error);
