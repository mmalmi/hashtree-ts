/**
 * Upload hook - manages file upload with progress tracking
 * Uses module-level state pattern for lightweight state management
 */
import { useSyncExternalStore, useCallback } from 'react';
import { toHex } from 'hashtree';
import type { Hash } from 'hashtree';
import { useAppStore, getTree, refreshDirectory } from '../store';
import { autosaveIfOwn } from '../nostr';
import { navigate } from '../utils/navigate';
import { getCurrentPathFromUrl } from '../utils/route';
import { clearFileSelection } from '../actions';
import { markFilesChanged } from './useRecentlyChanged';

// Upload progress type
export interface UploadProgress {
  current: number;
  total: number;
  fileName: string;
  bytes?: number;
  totalBytes?: number;
}

// Module-level state
let uploadProgress: UploadProgress | null = null;

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach(l => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return uploadProgress;
}

export function setUploadProgress(progress: UploadProgress | null) {
  uploadProgress = progress;
  emit();
}

export function getUploadProgress() {
  return uploadProgress;
}

export function useUploadProgress() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useUpload() {
  const progress = useUploadProgress();

  const uploadFiles = useCallback(async (files: FileList): Promise<void> => {
    if (!files.length) return;

    // Clear selected file so upload indicator is visible (updates URL)
    clearFileSelection();

    // Convert FileList to array immediately to prevent it from being cleared
    const filesArray = Array.from(files);
    const total = filesArray.length;
    const newFiles: { name: string; hash: Hash; size: number }[] = [];
    const tree = getTree();

    for (let i = 0; i < filesArray.length; i++) {
      const file = filesArray[i];
      if (!file) continue;
      const totalBytes = file.size;

      setUploadProgress({
        current: i + 1,
        total,
        fileName: file.name,
        bytes: 0,
        totalBytes,
      });

      // Read file with progress tracking
      const chunks: Uint8Array[] = [];
      let bytesRead = 0;
      const reader = file.stream().getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        bytesRead += value.length;
        setUploadProgress({
          current: i + 1,
          total,
          fileName: file.name,
          bytes: bytesRead,
          totalBytes,
        });
      }

      // Combine chunks
      const data = new Uint8Array(bytesRead);
      let offset = 0;
      for (const chunk of chunks) {
        data.set(chunk, offset);
        offset += chunk.length;
      }

      const { hash, size } = await tree.putFile(data);
      newFiles.push({ name: file.name, hash, size });
    }

    // Add to current directory or create new root
    const appState = useAppStore.getState();
    if (appState.rootHash) {
      // Add each file using setEntry
      let rootHash = appState.rootHash;
      const dirPath = getCurrentPathFromUrl(appState.entries);
      for (const file of newFiles) {
        rootHash = await tree.setEntry(rootHash, dirPath, file.name, file.hash, file.size);
      }
      appState.setRootHash(rootHash);
      await refreshDirectory();
      await autosaveIfOwn(toHex(rootHash));
    } else {
      const hash = await tree.putDirectory(newFiles);
      appState.setRootHash(hash);
      appState.setEntries(newFiles.map(f => ({ name: f.name, hash: f.hash, size: f.size, isTree: false })));
      navigate('/');
    }

    // Add uploaded files to recentlyChangedFiles for pulse effect
    const uploadedFileNames = new Set(newFiles.map(f => f.name));
    markFilesChanged(uploadedFileNames);

    setUploadProgress(null);
  }, []);

  return { uploadProgress: progress, uploadFiles };
}
