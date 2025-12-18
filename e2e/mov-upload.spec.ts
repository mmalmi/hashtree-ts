import { test, expect } from '@playwright/test';
import { setupPageErrorHandler, disableOthersPool } from './test-utils';

test.describe('MOV Upload', () => {
  test('SharedArrayBuffer and cross-origin isolation enabled', async ({ page }) => {
    test.setTimeout(30000);
    setupPageErrorHandler(page);

    await page.goto('/video.html#/');
    await disableOthersPool(page);

    // Wait for page to load and SW to initialize (may reload for COOP/COEP)
    await page.waitForTimeout(3000);

    // Check SharedArrayBuffer availability
    const sabAvailable = await page.evaluate(() => {
      return typeof SharedArrayBuffer !== 'undefined';
    });
    console.log('SharedArrayBuffer available:', sabAvailable);
    expect(sabAvailable).toBe(true);

    // Check crossOriginIsolated
    const coiStatus = await page.evaluate(() => {
      return (self as any).crossOriginIsolated;
    });
    console.log('Cross-origin isolated:', coiStatus);
    expect(coiStatus).toBe(true);
  });

  test('transcodes MOV file using streaming', async ({ page }) => {
    test.setTimeout(300000); // 5 minutes for transcode
    setupPageErrorHandler(page);

    page.on('console', msg => {
      console.log(`[browser ${msg.type()}]`, msg.text());
    });

    await page.goto('/video.html#/');
    await disableOthersPool(page);
    await page.waitForTimeout(3000);

    // Test streaming transcode with user-provided MOV file
    const result = await page.evaluate(async () => {
      try {
        const mod = await import('/src/utils/videoTranscode');
        const { transcodeToMP4Streaming, isTranscodingSupported } = mod;

        if (!isTranscodingSupported()) {
          return { success: false, error: 'SharedArrayBuffer not available' };
        }

        // Fetch a real MOV file (120MB)
        console.log('[Test] Fetching MOV file...');
        const response = await fetch('https://r2a.primal.net/uploads2/4/4e/67/44e6722b11c32eff0a384cd856f8bce3bd6480ec9bea42a3fa7ea58052905723.mov');
        if (!response.ok) {
          return { success: false, error: `Failed to fetch MOV: ${response.status}` };
        }
        const blob = await response.blob();
        const file = new File([blob], 'test.mov', { type: 'video/quicktime' });
        console.log('[Test] MOV file size:', file.size);

        // Collect chunks to measure output size
        const chunks: Uint8Array[] = [];
        let totalOutputSize = 0;

        console.log('[Test] Starting streaming transcode...');
        const result = await transcodeToMP4Streaming(
          file,
          async (chunk: Uint8Array) => {
            chunks.push(chunk);
            totalOutputSize += chunk.length;
            console.log('[Test] Got chunk:', chunk.length, 'total:', totalOutputSize);
          },
          (p: { message: string; percent?: number }) => {
            console.log('[Test] Progress:', p.message, p.percent ? `${p.percent}%` : '');
          }
        );

        console.log('[Test] Transcode complete! Output size:', totalOutputSize);
        return {
          success: true,
          inputSize: file.size,
          outputSize: totalOutputSize,
          mimeType: result.mimeType,
          extension: result.extension
        };
      } catch (e: unknown) {
        const err = e as Error;
        console.error('[Test] Error:', err);
        return { success: false, error: String(e), stack: err.stack };
      }
    });

    console.log('Transcode result:', result);
    expect(result.success).toBe(true);
    if (result.success && 'outputSize' in result) {
      expect(result.outputSize).toBeGreaterThan(0);
      expect(result.mimeType).toBe('video/mp4');
    }
  });
});
