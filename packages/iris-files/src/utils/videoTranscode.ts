/**
 * Video transcoding utility using FFmpeg WASM
 * Lazy-loads FFmpeg only when needed (for non-webm/mp4 files)
 */

let ffmpegInstance: any = null;
let loadingPromise: Promise<any> | null = null;

/**
 * Check if transcoding is supported (requires SharedArrayBuffer)
 */
export function isTranscodingSupported(): boolean {
  return typeof SharedArrayBuffer !== 'undefined';
}

/**
 * Check if a file can be transcoded
 */
export function canTranscode(file: File): { ok: boolean; reason?: string } {
  if (!isTranscodingSupported()) {
    return { ok: false, reason: 'SharedArrayBuffer not available (requires cross-origin isolation)' };
  }
  return { ok: true };
}

/**
 * Check if a file needs transcoding (non-webm/mp4)
 */
export function needsTranscoding(file: File): boolean {
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'webm' || ext === 'mp4') return false;
  return true;
}

/**
 * Lazy load FFmpeg WASM from local files in public folder
 */
async function loadFFmpeg(): Promise<any> {
  if (ffmpegInstance) return ffmpegInstance;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const { FFmpeg } = await import('@ffmpeg/ffmpeg');
    const { toBlobURL } = await import('@ffmpeg/util');

    const ffmpeg = new FFmpeg();

    // Load from local public folder (files copied from @ffmpeg/core)
    // toBlobURL fetches the file and creates a blob URL, which FFmpeg requires
    const coreURL = await toBlobURL('/ffmpeg-core.js', 'text/javascript');
    const wasmURL = await toBlobURL('/ffmpeg-core.wasm', 'application/wasm');

    await ffmpeg.load({ coreURL, wasmURL });
    ffmpegInstance = ffmpeg;
    return ffmpeg;
  })();

  return loadingPromise;
}

export interface TranscodeProgress {
  stage: 'loading' | 'transcoding' | 'done';
  message: string;
  percent?: number;
}

/**
 * Transcode video to MP4 format with streaming output
 * Outputs chunks to onChunk callback after transcoding completes
 *
 * Note: FFmpeg WASM runs synchronously, so we can't stream during encoding.
 * But we can stream the output to hashtree in chunks after encoding finishes.
 *
 * @param onChunk - Called with output chunks after transcoding
 */
export async function transcodeToMP4Streaming(
  file: File,
  onChunk: (chunk: Uint8Array) => Promise<void>,
  onProgress?: (progress: TranscodeProgress) => void
): Promise<{ mimeType: string; extension: string }> {
  const check = canTranscode(file);
  if (!check.ok) {
    throw new Error(check.reason);
  }

  onProgress?.({ stage: 'loading', message: 'Loading video encoder...' });

  let ffmpeg;
  try {
    ffmpeg = await loadFFmpeg();
  } catch (e) {
    throw new Error(`Failed to load video encoder: ${e instanceof Error ? e.message : String(e)}`);
  }

  const inputName = 'input' + getExtension(file.name);
  const outputName = 'output.mp4';

  onProgress?.({ stage: 'transcoding', message: 'Preparing video...', percent: 0 });

  // Write input file
  try {
    const { fetchFile } = await import('@ffmpeg/util');
    await ffmpeg.writeFile(inputName, await fetchFile(file));
  } catch (e) {
    throw new Error(`Failed to read video file: ${e instanceof Error ? e.message : String(e)}`);
  }

  onProgress?.({ stage: 'transcoding', message: 'Starting transcode...', percent: 5 });

  // Set up progress handler
  ffmpeg.on('progress', ({ progress }: { progress: number }) => {
    // 5-85% for transcoding
    const percent = 5 + Math.round(progress * 80);
    onProgress?.({
      stage: 'transcoding',
      message: `Transcoding: ${Math.round(progress * 100)}%`,
      percent
    });
  });

  // Transcode to MP4 with H.264
  try {
    await ffmpeg.exec([
      '-i', inputName,
      '-c:v', 'libx264',
      '-preset', 'veryfast',     // Fast encoding
      '-crf', '23',              // Good quality
      '-c:a', 'aac',
      '-b:a', '128k',
      '-vf', 'scale=-2:720',     // 720p max
      '-movflags', '+faststart', // Web-optimized
      outputName
    ]);
  } catch (e) {
    try { await ffmpeg.deleteFile(inputName); } catch {}
    throw new Error(`Transcoding failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Delete input immediately to free memory before reading output
  try { await ffmpeg.deleteFile(inputName); } catch {}

  onProgress?.({ stage: 'transcoding', message: 'Saving video...', percent: 85 });

  // Read output and stream in chunks
  try {
    const outputData = await ffmpeg.readFile(outputName) as Uint8Array;
    await ffmpeg.deleteFile(outputName); // Free output memory in WASM

    // Stream output in 1MB chunks
    const chunkSize = 1024 * 1024;
    for (let i = 0; i < outputData.length; i += chunkSize) {
      const chunk = outputData.slice(i, Math.min(i + chunkSize, outputData.length));
      await onChunk(chunk);

      const savePercent = 85 + Math.round((i / outputData.length) * 15);
      onProgress?.({
        stage: 'transcoding',
        message: `Saving: ${Math.round(i / 1024 / 1024)}MB / ${Math.round(outputData.length / 1024 / 1024)}MB`,
        percent: savePercent
      });
    }
  } catch (e) {
    throw new Error(`Failed to read transcoded video: ${e instanceof Error ? e.message : String(e)}`);
  }

  onProgress?.({ stage: 'done', message: 'Transcoding complete', percent: 100 });

  return {
    mimeType: 'video/mp4',
    extension: 'mp4'
  };
}

function getExtension(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  return ext ? `.${ext}` : '';
}
