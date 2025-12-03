import { useSyncExternalStore } from 'react';
import { toHex, cid } from 'hashtree';
import type { Hash, StreamWriter } from 'hashtree';
import {
  getTree,
  useAppStore,
} from '../../store';
import { autosaveIfOwn, useNostrStore } from '../../nostr';
import { navigate } from '../../utils/navigate';
import { getCurrentPathFromUrl } from '../../utils/route';

// Generate default stream filename
export function getDefaultFilename(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `stream_${d.getFullYear()}_${pad(d.getMonth() + 1)}_${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

// Stream state interface
interface StreamState {
  isRecording: boolean;
  isPreviewing: boolean;
  recordingTime: number;
  streamFilename: string;
  persistStream: boolean;
  streamWriter: StreamWriter | null;
  streamStats: { chunks: number; buffered: number; totalSize: number };
}

// Module-level state
let state: StreamState = {
  isRecording: false,
  isPreviewing: false,
  recordingTime: 0,
  streamFilename: getDefaultFilename(),
  persistStream: true,
  streamWriter: null,
  streamStats: { chunks: 0, buffered: 0, totalSize: 0 },
};

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach(l => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return state;
}

// Non-hook getter for use in non-React code
export function getStreamState() {
  return state;
}

// State setters
export function setIsRecording(recording: boolean) {
  state = { ...state, isRecording: recording };
  emit();
}

export function setIsPreviewing(previewing: boolean) {
  state = { ...state, isPreviewing: previewing };
  emit();
}

export function setRecordingTime(time: number) {
  state = { ...state, recordingTime: time };
  emit();
}

export function setStreamFilename(filename: string) {
  state = { ...state, streamFilename: filename };
  emit();
}

export function setPersistStream(persist: boolean) {
  state = { ...state, persistStream: persist };
  emit();
}

export function setStreamWriter(streamWriter: StreamWriter | null) {
  state = { ...state, streamWriter };
  emit();
}

export function setStreamStats(stats: { chunks: number; buffered: number; totalSize: number }) {
  state = { ...state, streamStats: stats };
  emit();
}

/**
 * Hook to read stream state
 */
export function useStreamState() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// Module state for media
let mediaStream: MediaStream | null = null;
let mediaRecorder: MediaRecorder | null = null;
let recordingInterval: number | null = null;
let publishInterval: number | null = null;
let recentChunks: Uint8Array[] = [];

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

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

export async function startRecording(videoEl: HTMLVideoElement | null): Promise<void> {
  if (!mediaStream) {
    await startPreview(videoEl);
    if (!mediaStream) return;
  }

  // Reset state
  recentChunks = [];
  const tree = getTree();
  const newStreamWriter = tree.createStream();
  setStreamWriter(newStreamWriter);
  setStreamStats({ chunks: 0, buffered: 0, totalSize: 0 });

  mediaRecorder = new MediaRecorder(mediaStream, {
    mimeType: 'video/webm;codecs=vp8,opus',
    videoBitsPerSecond: 1000000,
  });

  mediaRecorder.ondataavailable = async (event) => {
    if (event.data.size > 0) {
      const chunk = new Uint8Array(await event.data.arrayBuffer());
      const currentState = getSnapshot();

      if (currentState.persistStream) {
        const streamWriter = currentState.streamWriter;
        if (streamWriter) {
          await streamWriter.append(chunk);
          setStreamStats(streamWriter.stats);
        }
      } else {
        recentChunks.push(chunk);
        if (recentChunks.length > 30) {
          recentChunks.shift();
        }
        setStreamStats({
          chunks: recentChunks.length,
          buffered: 0,
          totalSize: recentChunks.reduce((sum, c) => sum + c.length, 0),
        });
      }
    }
  };

  mediaRecorder.start(1000);
  setIsRecording(true);
  setRecordingTime(0);

  recordingInterval = window.setInterval(() => {
    const currentState = getSnapshot();
    setRecordingTime(currentState.recordingTime + 1);
  }, 1000);

  // Publish to nostr every 3 seconds (check login/tree state inside interval)
  publishInterval = window.setInterval(async () => {
    const nostrState = useNostrStore.getState();
    // Only publish if logged in and have a selected tree
    if (!nostrState.isLoggedIn || !nostrState.selectedTree) {
      return;
    }

    const currentState = getSnapshot();
    const appState = useAppStore.getState();
    const filename = `${currentState.streamFilename}.webm`;

    const tree = getTree();
    let fileHash: Hash | undefined, fileSize: number | undefined;
    if (currentState.persistStream && currentState.streamWriter) {
      const result = await currentState.streamWriter.finalize();
      fileHash = result.hash;
      fileSize = result.size;
    } else if (!currentState.persistStream && recentChunks.length > 0) {
      const combined = concatChunks(recentChunks);
      const result = await tree.putFile(combined, { public: true });
      fileHash = result.cid.hash;
      fileSize = result.size;
    } else {
      return;
    }

    if (appState.rootCid) {
      const currentPath = getCurrentPathFromUrl();
      const newRootCid = await tree.setEntry(appState.rootCid, currentPath, filename, cid(fileHash), fileSize);
      appState.setRootCid(newRootCid);
      await autosaveIfOwn(toHex(newRootCid.hash));
    } else {
      const newRootCid = (await tree.putDirectory([{ name: filename, cid: cid(fileHash), size: fileSize }], { public: true })).cid;
      appState.setRootCid(newRootCid);
    }
  }, 3000);

}

export async function stopRecording(): Promise<void> {
  if (recordingInterval) {
    clearInterval(recordingInterval);
    recordingInterval = null;
  }

  if (publishInterval) {
    clearInterval(publishInterval);
    publishInterval = null;
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

  const currentState = getSnapshot();
  const filename = `${currentState.streamFilename}.webm`;

  const tree = getTree();
  let fileHash: Hash | undefined, fileSize: number | undefined;
  if (currentState.persistStream && currentState.streamWriter) {
    const result = await currentState.streamWriter.finalize();
    fileHash = result.hash;
    fileSize = result.size;
  } else if (!currentState.persistStream && recentChunks.length > 0) {
    const combined = concatChunks(recentChunks);
    const result = await tree.putFile(combined, { public: true });
    fileHash = result.cid.hash;
    fileSize = result.size;
  }

  if (fileHash && fileSize) {
    const appState = useAppStore.getState();
    if (appState.rootCid) {
      const currentPath = getCurrentPathFromUrl();
      const newRootCid = await tree.setEntry(appState.rootCid, currentPath, filename, cid(fileHash), fileSize);
      appState.setRootCid(newRootCid);
      await autosaveIfOwn(toHex(newRootCid.hash));
    } else {
      const newRootCid = (await tree.putDirectory([{ name: filename, cid: cid(fileHash), size: fileSize }], { public: true })).cid;
      appState.setRootCid(newRootCid);
      navigate('/');
    }
  }

  setStreamWriter(null);
  recentChunks = [];
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
