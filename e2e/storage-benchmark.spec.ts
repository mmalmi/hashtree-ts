/**
 * Storage benchmark tests - compares IndexedDB and OPFS performance
 */
import { test, expect } from '@playwright/test';

test.setTimeout(60000);

test.describe('Storage Benchmark', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('header', { timeout: 10000 });
    await page.waitForFunction(() => !!(window as any).__hashtree, { timeout: 10000 });

    // Clear storage before each test
    await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      // @ts-ignore
      for await (const [name] of root.entries()) {
        await root.removeEntry(name, { recursive: true });
      }
    });
  });

  // Skip: IndexedDBStore was replaced with DexieStore in hashtree-web
  test.skip('IndexedDB vs OPFS write/read performance', async ({ page }) => {
    const result = await page.evaluate(async () => {
      // @ts-ignore
      const { IndexedDBStore, OpfsStore, sha256 } = window.__hashtree;

      const iterations = 100;
      const dataSize = 1024;
      const testData: { hash: Uint8Array; data: Uint8Array }[] = [];

      for (let i = 0; i < iterations; i++) {
        const data = new Uint8Array(dataSize);
        crypto.getRandomValues(data);
        const hash = await sha256(data);
        testData.push({ hash, data });
      }

      // IndexedDB
      const idbStore = new IndexedDBStore('benchmark-idb');
      const idbWriteStart = performance.now();
      for (const { hash, data } of testData) {
        await idbStore.put(hash, data);
      }
      await idbStore.flush();
      const idbWriteEnd = performance.now();

      // Read back from new instance
      const idbStore2 = new IndexedDBStore('benchmark-idb');
      const idbReadStart = performance.now();
      let idbVerified = 0;
      for (const { hash, data } of testData) {
        const retrieved = await idbStore2.get(hash);
        if (retrieved && retrieved.length === data.length) idbVerified++;
      }
      const idbReadEnd = performance.now();
      await idbStore.close();

      // OPFS
      const opfsStore = new OpfsStore('benchmark-opfs');
      const opfsWriteStart = performance.now();
      for (const { hash, data } of testData) {
        await opfsStore.put(hash, data);
      }
      await opfsStore.flush();
      const opfsWriteEnd = performance.now();

      // Read back from new instance
      const opfsStore2 = new OpfsStore('benchmark-opfs');
      const opfsReadStart = performance.now();
      let opfsVerified = 0;
      for (const { hash, data } of testData) {
        const retrieved = await opfsStore2.get(hash);
        if (retrieved && retrieved.length === data.length) opfsVerified++;
      }
      const opfsReadEnd = performance.now();
      await opfsStore.close();

      return {
        idbWrite: Math.round(idbWriteEnd - idbWriteStart),
        idbRead: Math.round(idbReadEnd - idbReadStart),
        idbVerified,
        opfsWrite: Math.round(opfsWriteEnd - opfsWriteStart),
        opfsRead: Math.round(opfsReadEnd - opfsReadStart),
        opfsVerified,
        iterations,
      };
    });

    expect(result.idbVerified).toBe(result.iterations);
    expect(result.opfsVerified).toBe(result.iterations);
  });
});
