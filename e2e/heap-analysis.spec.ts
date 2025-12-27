/**
 * Heap Analysis Tests
 *
 * Uses Chrome DevTools Protocol to take heap snapshots and analyze memory usage.
 * Run with: pnpm run test:e2e -- e2e/heap-analysis.spec.ts
 *
 * Agent Workflow for Memory Investigation:
 * 1. Run this test to get baseline memory and NDK instance count
 * 2. If multiple NDK instances found, trace their retention paths
 * 3. Look for large objects (>100KB) and trace what holds them
 * 4. Check for unbounded growth in caches, maps, arrays
 * 5. Apply fixes and re-run to verify improvement
 */

import { test, expect } from '@playwright/test';
import { setupPageErrorHandler, disableOthersPool } from './test-utils.js';

interface HeapNode {
  type: string;
  name: string;
  id: number;
  selfSize: number;
  edgeCount: number;
}

interface HeapAnalysis {
  totalNodes: number;
  memoryByType: Record<string, { count: number; size: number }>;
  ndkInstances: number[];
  ndkCacheInstances: number[];
  profileStrings: { count: number; totalSize: number };
  largeObjects: Array<{ type: string; name: string; size: number; id: number }>;
}

async function takeHeapSnapshot(page: any): Promise<any> {
  const client = await page.context().newCDPSession(page);
  await client.send('HeapProfiler.enable');

  // Force garbage collection first
  await client.send('HeapProfiler.collectGarbage');
  await new Promise(r => setTimeout(r, 500));
  await client.send('HeapProfiler.collectGarbage');

  // Collect snapshot chunks
  const chunks: string[] = [];
  client.on('HeapProfiler.addHeapSnapshotChunk', (event: { chunk: string }) => {
    chunks.push(event.chunk);
  });

  await client.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });

  const snapshotJson = chunks.join('');
  return JSON.parse(snapshotJson);
}

function analyzeHeap(snapshot: any): HeapAnalysis {
  const { nodes, strings } = snapshot;
  const meta = snapshot.snapshot.meta;
  const nodeFields = meta.node_fields;
  const nodeTypes = meta.node_types[0];
  const nodeFieldCount = nodeFields.length;

  const typeIdx = nodeFields.indexOf('type');
  const nameIdx = nodeFields.indexOf('name');
  const idIdx = nodeFields.indexOf('id');
  const selfSizeIdx = nodeFields.indexOf('self_size');

  const nodeCount = nodes.length / nodeFieldCount;

  const memoryByType: Record<string, { count: number; size: number }> = {};
  const ndkInstances: number[] = [];
  const ndkCacheInstances: number[] = [];
  const largeObjects: Array<{ type: string; name: string; size: number; id: number }> = [];
  let profileCount = 0;
  let profileSize = 0;

  for (let i = 0; i < nodeCount; i++) {
    const offset = i * nodeFieldCount;
    const nodeType = nodeTypes[nodes[offset + typeIdx]];
    const nameStrIdx = nodes[offset + nameIdx];
    const name = strings[nameStrIdx] || '';
    const nodeId = nodes[offset + idIdx];
    const selfSize = nodes[offset + selfSizeIdx];

    // Memory by type
    if (!memoryByType[nodeType]) {
      memoryByType[nodeType] = { count: 0, size: 0 };
    }
    memoryByType[nodeType].count++;
    memoryByType[nodeType].size += selfSize;

    // NDK instances
    if (nodeType === 'object' && name === 'NDK') {
      ndkInstances.push(nodeId);
    }
    if (nodeType === 'object' && name === 'NDKCacheAdapterDexie') {
      ndkCacheInstances.push(nodeId);
    }

    // Profile strings (kind:0 events)
    if (nodeType === 'string' && name.startsWith('[0,')) {
      profileCount++;
      profileSize += selfSize;
    }

    // Large objects (>100KB)
    if (selfSize > 100 * 1024) {
      largeObjects.push({ type: nodeType, name: name.slice(0, 100), size: selfSize, id: nodeId });
    }
  }

  return {
    totalNodes: nodeCount,
    memoryByType,
    ndkInstances,
    ndkCacheInstances,
    profileStrings: { count: profileCount, totalSize: profileSize },
    largeObjects: largeObjects.sort((a, b) => b.size - a.size).slice(0, 20),
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

test.describe('Heap Analysis', () => {
  test('analyze memory on fresh page load', async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await disableOthersPool(page);

    // Wait for app to settle
    await page.waitForTimeout(3000);

    console.log('\n📊 Taking heap snapshot...');
    const snapshot = await takeHeapSnapshot(page);
    const analysis = analyzeHeap(snapshot);

    console.log('\n=== HEAP ANALYSIS ===\n');
    console.log(`Total nodes: ${analysis.totalNodes.toLocaleString()}`);

    console.log('\n--- Memory by Type ---');
    const sortedTypes = Object.entries(analysis.memoryByType)
      .sort((a, b) => b[1].size - a[1].size)
      .slice(0, 10);
    for (const [type, { count, size }] of sortedTypes) {
      console.log(`  ${type.padEnd(25)} count=${count.toString().padStart(8)}  size=${formatBytes(size).padStart(10)}`);
    }

    console.log('\n--- NDK Instances ---');
    console.log(`  NDK: ${analysis.ndkInstances.length} instances`);
    console.log(`  NDKCacheAdapterDexie: ${analysis.ndkCacheInstances.length} instances`);
    if (analysis.ndkInstances.length > 1) {
      console.log('  ⚠️  Multiple NDK instances detected! IDs:', analysis.ndkInstances);
    }

    console.log('\n--- Profile Events (kind:0) ---');
    console.log(`  Count: ${analysis.profileStrings.count}`);
    console.log(`  Total size: ${formatBytes(analysis.profileStrings.totalSize)}`);

    if (analysis.largeObjects.length > 0) {
      console.log('\n--- Large Objects (>100KB) ---');
      for (const obj of analysis.largeObjects.slice(0, 10)) {
        console.log(`  ${formatBytes(obj.size).padStart(10)}  ${obj.type}:${obj.name.slice(0, 50)}`);
      }
    }

    // Assertions for regression testing
    expect(analysis.ndkInstances.length).toBeLessThanOrEqual(1);
    expect(analysis.ndkCacheInstances.length).toBeLessThanOrEqual(1);
  });

  test('analyze memory after navigation', async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await disableOthersPool(page);

    // Wait for initial load
    await expect(page.locator('header').first()).toBeVisible({ timeout: 30000 });

    // Navigate around
    const publicLink = page.getByRole('link', { name: 'public' }).first();
    if (await publicLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await publicLink.click();
      await page.waitForTimeout(1000);
    }

    // Go back home
    await page.locator('header a:has-text("Iris")').click();
    await page.waitForTimeout(1000);

    console.log('\n📊 Taking heap snapshot after navigation...');
    const snapshot = await takeHeapSnapshot(page);
    const analysis = analyzeHeap(snapshot);

    console.log('\n=== HEAP ANALYSIS (after navigation) ===\n');
    console.log(`Total nodes: ${analysis.totalNodes.toLocaleString()}`);
    console.log(`NDK instances: ${analysis.ndkInstances.length}`);
    console.log(`Profile strings: ${analysis.profileStrings.count} (${formatBytes(analysis.profileStrings.totalSize)})`);

    // Check for memory issues
    const totalMemory = Object.values(analysis.memoryByType).reduce((sum, t) => sum + t.size, 0);
    console.log(`Total heap size: ${formatBytes(totalMemory)}`);

    expect(analysis.ndkInstances.length).toBeLessThanOrEqual(1);
  });

  test('compare memory before and after actions', async ({ page }) => {
    setupPageErrorHandler(page);
    await page.goto('/');
    await disableOthersPool(page);

    await page.waitForTimeout(2000);

    // Take baseline snapshot
    console.log('\n📊 Taking BEFORE snapshot...');
    const beforeSnapshot = await takeHeapSnapshot(page);
    const beforeAnalysis = analyzeHeap(beforeSnapshot);

    // Do some actions
    await page.waitForTimeout(5000); // Let app run

    // Take after snapshot
    console.log('📊 Taking AFTER snapshot...');
    const afterSnapshot = await takeHeapSnapshot(page);
    const afterAnalysis = analyzeHeap(afterSnapshot);

    // Compare
    console.log('\n=== MEMORY COMPARISON ===\n');

    const beforeTotal = Object.values(beforeAnalysis.memoryByType).reduce((sum, t) => sum + t.size, 0);
    const afterTotal = Object.values(afterAnalysis.memoryByType).reduce((sum, t) => sum + t.size, 0);
    const diff = afterTotal - beforeTotal;

    console.log(`Before: ${formatBytes(beforeTotal)}`);
    console.log(`After:  ${formatBytes(afterTotal)}`);
    console.log(`Diff:   ${diff >= 0 ? '+' : ''}${formatBytes(diff)}`);

    console.log('\n--- Changes by Type ---');
    for (const type of Object.keys(afterAnalysis.memoryByType)) {
      const before = beforeAnalysis.memoryByType[type]?.size || 0;
      const after = afterAnalysis.memoryByType[type]?.size || 0;
      const typeDiff = after - before;
      if (Math.abs(typeDiff) > 100 * 1024) { // Only show >100KB changes
        console.log(`  ${type.padEnd(25)} ${typeDiff >= 0 ? '+' : ''}${formatBytes(typeDiff)}`);
      }
    }

    console.log('\n--- NDK Instances ---');
    console.log(`  Before: ${beforeAnalysis.ndkInstances.length}`);
    console.log(`  After:  ${afterAnalysis.ndkInstances.length}`);

    console.log('\n--- Profile Strings ---');
    console.log(`  Before: ${beforeAnalysis.profileStrings.count} (${formatBytes(beforeAnalysis.profileStrings.totalSize)})`);
    console.log(`  After:  ${afterAnalysis.profileStrings.count} (${formatBytes(afterAnalysis.profileStrings.totalSize)})`);
  });
});
