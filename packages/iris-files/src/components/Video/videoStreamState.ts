/**
 * Video Streaming State for Video App
 *
 * Handles webcam/mic recording and saving to videos/{title} trees.
 * Simplified version of stream/streamState.ts for video-specific use.
 */

import { writable, get } from 'svelte/store';
import { cid, toHex, videoChunker } from 'hashtree';
import type { StreamWriter, CID, TreeVisibility } from 'hashtree';
import { getTree } from '../../store';
import { saveHashtree } from '../../nostr';
import { nostrStore } from '../../nostr';
import { addRecent } from '../../stores/recents';
import { storeLinkKey } from '../../stores/trees';
import { patchWebmDuration } from '../../utils/webmDuration';

// Stream state interface
interface VideoStreamState {
  isRecording: boolean;
  isPreviewing: boolean;
  recordingTime: number;
  streamWriter: StreamWriter | null;
  streamStats: { chunks: number; buffered: number; totalSize: number };
}

// Initial state
const initialState: VideoStreamState = {
  isRecording: false,
  isPreviewing: false,
  recordingTime: 0,
  streamWriter: null,
  streamStats: { chunks: 0, buffered: 0, totalSize: 0 },
};

// Create Svelte store
export const videoStreamStore = writable<VideoStreamState>(initialState);

// Non-hook getter for use in non-reactive code
export function getVideoStreamState(): VideoStreamState {
  return get(videoStreamStore);
}

// State setters
export function setIsRecording(recording: boolean) {
  videoStreamStore.update(s => ({ ...s, isRecording: recording }));
}

export function setIsPreviewing(previewing: boolean) {
  videoStreamStore.update(s => ({ ...s, isPreviewing: previewing }));
}

export function setRecordingTime(time: number) {
  videoStreamStore.update(s => ({ ...s, recordingTime: time }));
}

export function setStreamWriter(streamWriter: StreamWriter | null) {
  videoStreamStore.update(s => ({ ...s, streamWriter }));
}

export function setStreamStats(stats: { chunks: number; buffered: number; totalSize: number }) {
  videoStreamStore.update(s => ({ ...s, streamStats: stats }));
}

// Module state for media
let mediaStream: MediaStream | null = null;
let mediaRecorder: MediaRecorder | null = null;
let recordingInterval: number | null = null;

export function getMediaStream(): MediaStream | null {
  return mediaStream;
}

export async function startPreview(videoEl: HTMLVideoElement | null): Promise<void> {
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    if (videoEl) {
      videoEl.srcObject = mediaStream;
    }
    setIsPreviewing(true);
  } catch (e) {
    console.error('Camera error:', e);
    throw e;
  }
}

export function stopPreview(videoEl: HTMLVideoElement | null): void {
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }
  if (videoEl) {
    videoEl.srcObject = null;
  }
  setIsPreviewing(false);
}

export async function startRecording(videoEl: HTMLVideoElement | null, isPublic: boolean): Promise<void> {
  if (!mediaStream) {
    await startPreview(videoEl);
    if (!mediaStream) return;
  }

  // Reset state
  const tree = getTree();
  const newStreamWriter = tree.createStream({ public: isPublic, chunker: videoChunker() });
  setStreamWriter(newStreamWriter);
  setStreamStats({ chunks: 0, buffered: 0, totalSize: 0 });

  mediaRecorder = new MediaRecorder(mediaStream, {
    mimeType: 'video/webm;codecs=vp8,opus',
    videoBitsPerSecond: 1000000,
  });

  mediaRecorder.ondataavailable = async (event) => {
    if (event.data.size > 0) {
      const chunk = new Uint8Array(await event.data.arrayBuffer());
      const currentState = getVideoStreamState();

      const streamWriter = currentState.streamWriter;
      if (streamWriter) {
        await streamWriter.append(chunk);
        setStreamStats(streamWriter.stats);
      }
    }
  };

  mediaRecorder.start(1000); // 1 second chunks
  setIsRecording(true);
  setRecordingTime(0);

  recordingInterval = window.setInterval(() => {
    const currentState = getVideoStreamState();
    setRecordingTime(currentState.recordingTime + 1);
  }, 1000);
}

interface StopRecordingResult {
  success: boolean;
  videoUrl?: string;
}

export async function stopRecording(
  title: string,
  description: string,
  visibility: TreeVisibility,
  thumbnailBlob: Blob | null
): Promise<StopRecordingResult> {
  if (recordingInterval) {
    clearInterval(recordingInterval);
    recordingInterval = null;
  }

  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
    mediaRecorder = null;
  }

  // Stop media stream (camera/microphone)
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }

  setIsRecording(false);
  setIsPreviewing(false);

  const currentState = getVideoStreamState();
  const durationMs = currentState.recordingTime * 1000;
  const isPublic = visibility === 'public';

  const tree = getTree();
  let fileCid: CID | undefined;
  let fileSize: number | undefined;

  if (currentState.streamWriter) {
    const result = await currentState.streamWriter.finalize();
    fileCid = cid(result.hash, result.key);
    fileSize = result.size;
  }

  // Patch WebM duration
  if (fileCid && durationMs > 0) {
    console.log(`[VideoStream] Patching WebM duration: ${durationMs}ms`);
    fileCid = await patchWebmDuration(tree, fileCid, durationMs);
  }

  if (!fileCid || !fileSize) {
    setStreamWriter(null);
    return { success: false };
  }

  const nostrState = nostrStore.getState();
  const userNpub = nostrState.npub;

  if (!userNpub) {
    setStreamWriter(null);
    return { success: false };
  }

  // Build video directory
  const treeName = `videos/${title.trim()}`;
  const entries: Array<{ name: string; cid: CID; size?: number }> = [
    { name: 'video.webm', cid: fileCid, size: fileSize },
  ];

  // Upload title.txt
  const titleData = new TextEncoder().encode(title.trim());
  const titleResult = await tree.putFile(titleData, { public: isPublic });
  entries.push({ name: 'title.txt', cid: titleResult.cid, size: titleResult.size });

  // Upload description.txt if provided
  if (description.trim()) {
    const descData = new TextEncoder().encode(description.trim());
    const descResult = await tree.putFile(descData, { public: isPublic });
    entries.push({ name: 'description.txt', cid: descResult.cid, size: descResult.size });
  }

  // Upload thumbnail if available
  if (thumbnailBlob) {
    const thumbData = new Uint8Array(await thumbnailBlob.arrayBuffer());
    const thumbResult = await tree.putFile(thumbData, { public: isPublic });
    entries.push({ name: 'thumbnail.jpg', cid: thumbResult.cid, size: thumbResult.size });
  }

  // Create directory
  const dirResult = await tree.putDirectory(entries, { public: isPublic });

  // Publish to Nostr
  const rootHash = toHex(dirResult.cid.hash);
  const rootKey = dirResult.cid.key ? toHex(dirResult.cid.key) : undefined;

  const result = await saveHashtree(treeName, rootHash, rootKey, { visibility });

  // Store link key for unlisted videos
  if (result.linkKey && userNpub) {
    storeLinkKey(userNpub, treeName, result.linkKey);
  }

  // Add to recents
  addRecent({
    type: 'tree',
    path: `/${userNpub}/${treeName}`,
    label: title.trim(),
    npub: userNpub,
    treeName,
    visibility,
    linkKey: result.linkKey,
  });

  setStreamWriter(null);

  // Build video URL
  const encodedTreeName = encodeURIComponent(treeName);
  const videoUrl = result.linkKey
    ? `#/${userNpub}/${encodedTreeName}?k=${result.linkKey}`
    : `#/${userNpub}/${encodedTreeName}`;

  return { success: true, videoUrl };
}

export function cancelRecording(): void {
  if (recordingInterval) {
    clearInterval(recordingInterval);
    recordingInterval = null;
  }

  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
    mediaRecorder = null;
  }

  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }

  setIsRecording(false);
  setIsPreviewing(false);
  setStreamWriter(null);
  setStreamStats({ chunks: 0, buffered: 0, totalSize: 0 });
  setRecordingTime(0);
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
