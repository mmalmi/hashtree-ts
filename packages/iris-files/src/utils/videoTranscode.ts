/**
 * Video transcoding utility using FFmpeg WASM
 * Lazy-loads FFmpeg only when needed (for non-webm files)
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
 * Check if a file needs transcoding (non-webm/mp4)
 */
export function needsTranscoding(file: File): boolean {
  const ext = file.name.split('.').pop()?.toLowerCase();
  // WebM and MP4 are widely supported, skip transcoding
  if (ext === 'webm' || ext === 'mp4') return false;
  // MOV, AVI, MKV etc need transcoding
  return true;
}

/**
 * Lazy load FFmpeg WASM
 */
async function loadFFmpeg(onProgress?: (msg: string) => void): Promise<any> {
  if (ffmpegInstance) return ffmpegInstance;

  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    onProgress?.('Loading video encoder...');

    const { FFmpeg } = await import('@ffmpeg/ffmpeg');
    const { toBlobURL } = await import('@ffmpeg/util');

    const ffmpeg = new FFmpeg();

    // Load FFmpeg core from CDN
    // Use mt (multi-threaded) version for better performance
    const baseURL = 'https://unpkg.com/@ffmpeg/core-mt@0.12.6/dist/esm';

    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      workerURL: await toBlobURL(`${baseURL}/ffmpeg-core.worker.js`, 'text/javascript'),
    });

    ffmpegInstance = ffmpeg;
    return ffmpeg;
  })();

  return loadingPromise;
}

export interface TranscodeResult {
  data: Uint8Array;
  mimeType: string;
  extension: string;
}

export interface TranscodeProgress {
  stage: 'loading' | 'transcoding' | 'done';
  message: string;
  percent?: number;
}

/**
 * Transcode video to WebM VP9 format
 */
export async function transcodeToWebM(
  file: File,
  onProgress?: (progress: TranscodeProgress) => void
): Promise<TranscodeResult> {
  // Check SharedArrayBuffer support
  if (!isTranscodingSupported()) {
    throw new Error('Video transcoding requires SharedArrayBuffer. Please use Chrome/Edge or enable cross-origin isolation.');
  }

  onProgress?.({ stage: 'loading', message: 'Loading video encoder...' });

  let ffmpeg;
  try {
    ffmpeg = await loadFFmpeg();
  } catch (e) {
    throw new Error(`Failed to load video encoder: ${e instanceof Error ? e.message : String(e)}`);
  }

  const inputName = 'input' + getExtension(file.name);
  const outputName = 'output.webm';

  // Write input file
  onProgress?.({ stage: 'transcoding', message: 'Preparing video...', percent: 0 });

  try {
    const { fetchFile } = await import('@ffmpeg/util');
    await ffmpeg.writeFile(inputName, await fetchFile(file));
  } catch (e) {
    throw new Error(`Failed to read video file: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Set up progress handler
  ffmpeg.on('progress', ({ progress }: { progress: number }) => {
    const percent = Math.round(progress * 100);
    onProgress?.({
      stage: 'transcoding',
      message: `Transcoding: ${percent}%`,
      percent
    });
  });

  // Transcode to WebM with VP9 video and Opus audio
  // Using reasonable quality settings for web
  try {
    await ffmpeg.exec([
      '-i', inputName,
      '-c:v', 'libvpx-vp9',   // VP9 video codec
      '-crf', '30',            // Quality (lower = better, 30 is decent for web)
      '-b:v', '0',             // Variable bitrate
      '-c:a', 'libopus',       // Opus audio codec
      '-b:a', '128k',          // Audio bitrate
      '-vf', 'scale=-2:720',   // Scale to 720p max, maintain aspect
      outputName
    ]);
  } catch (e) {
    throw new Error(`Transcoding failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Read output
  let data: Uint8Array;
  try {
    data = await ffmpeg.readFile(outputName) as Uint8Array;
  } catch (e) {
    throw new Error(`Failed to read transcoded video: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Cleanup
  try {
    await ffmpeg.deleteFile(inputName);
    await ffmpeg.deleteFile(outputName);
  } catch {
    // Ignore cleanup errors
  }

  onProgress?.({ stage: 'done', message: 'Transcoding complete', percent: 100 });

  return {
    data,
    mimeType: 'video/webm',
    extension: 'webm'
  };
}

function getExtension(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  return ext ? `.${ext}` : '';
}

/**
 * Get video duration using FFmpeg (for files where browser can't read metadata)
 */
export async function getVideoDuration(file: File): Promise<number | null> {
  try {
    const ffmpeg = await loadFFmpeg();
    const inputName = 'probe' + getExtension(file.name);

    const { fetchFile } = await import('@ffmpeg/util');
    await ffmpeg.writeFile(inputName, await fetchFile(file));

    // Use ffprobe-like approach
    let duration: number | null = null;

    ffmpeg.on('log', ({ message }: { message: string }) => {
      const match = message.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
      if (match) {
        const hours = parseInt(match[1]);
        const minutes = parseInt(match[2]);
        const seconds = parseFloat(match[3]);
        duration = hours * 3600 + minutes * 60 + seconds;
      }
    });

    await ffmpeg.exec(['-i', inputName, '-f', 'null', '-']);
    await ffmpeg.deleteFile(inputName);

    return duration;
  } catch {
    return null;
  }
}
