/**
 * Upload hook - manages file upload with progress tracking
 * Uses module-level state pattern for lightweight state management
 */
import { useSyncExternalStore, useCallback } from 'react';
import { toHex, nhashEncode } from 'hashtree';
import type { Hash } from 'hashtree';
import { useAppStore, getTree } from '../store';
import { autosaveIfOwn, saveHashtree, useNostrStore } from '../nostr';
import { navigate } from '../utils/navigate';
import { getCurrentPathFromUrl, parseRoute } from '../utils/route';
import { clearFileSelection } from '../actions';
import { markFilesChanged } from './useRecentlyChanged';
import { nip19 } from 'nostr-tools';

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
    const route = parseRoute();

    if (appState.rootHash) {
      // Add each file using setEntry
      let rootHash = appState.rootHash;
      const dirPath = getCurrentPathFromUrl();
      for (const file of newFiles) {
        rootHash = await tree.setEntry(rootHash, dirPath, file.name, file.hash, file.size);
      }
      appState.setRootHash(rootHash);
      await autosaveIfOwn(toHex(rootHash));
    } else if (route.npub && route.treeName) {
      // Creating new tree in a virtual directory (e.g., /npub/home that doesn't exist yet)
      // Check if this is our own npub
      const nostrStore = useNostrStore.getState();
      let routePubkey: string | null = null;
      try {
        const decoded = nip19.decode(route.npub);
        if (decoded.type === 'npub') routePubkey = decoded.data as string;
      } catch {}

      if (routePubkey && routePubkey === nostrStore.pubkey) {
        // Create the tree and save it
        const hash = await tree.putDirectory(newFiles);
        appState.setRootHash(hash);
        const hashHex = toHex(hash);
        await saveHashtree(route.treeName, hashHex);

        // Set selectedTree so future autosaves work
        nostrStore.setSelectedTree({
          id: '',
          name: route.treeName,
          pubkey: routePubkey,
          rootHash: hashHex,
          created_at: Math.floor(Date.now() / 1000),
        });
      } else {
        // Not our tree, just create local directory
        const hash = await tree.putDirectory(newFiles);
        appState.setRootHash(hash);
      }
    } else {
      const hash = await tree.putDirectory(newFiles);
      appState.setRootHash(hash);
      navigate('/');
    }

    // Add uploaded files to recentlyChangedFiles for pulse effect
    const uploadedFileNames = new Set(newFiles.map(f => f.name));
    markFilesChanged(uploadedFileNames);

    setUploadProgress(null);

    // If single file uploaded, navigate to it
    if (newFiles.length === 1) {
      const route = parseRoute();
      const dirPath = getCurrentPathFromUrl();
      const fileName = newFiles[0].name;

      if (route.npub && route.treeName) {
        // Tree route: /npub/treeName/path/filename
        const parts = [route.npub, route.treeName, ...dirPath, fileName];
        navigate('/' + parts.map(encodeURIComponent).join('/'));
      } else if (route.hash) {
        // Hash route: /nhash1.../path/filename
        const nhash = nhashEncode(route.hash);
        const parts = [nhash, ...dirPath, fileName];
        navigate('/' + parts.map(encodeURIComponent).join('/'));
      }
    }
  }, []);

  return { uploadProgress: progress, uploadFiles };
}
