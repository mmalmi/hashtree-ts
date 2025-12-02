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
    const uploadedFileNames: string[] = [];
    const tree = getTree();
    const route = parseRoute();
    const dirPath = getCurrentPathFromUrl();

    // Check if we need to initialize a new tree (virtual directory case)
    const appState = useAppStore.getState();
    let needsTreeInit = !appState.rootHash && route.npub && route.treeName;
    let isOwnTree = false;
    let routePubkey: string | null = null;

    if (needsTreeInit) {
      const nostrStore = useNostrStore.getState();
      try {
        const decoded = nip19.decode(route.npub!);
        if (decoded.type === 'npub') routePubkey = decoded.data as string;
      } catch {}
      isOwnTree = routePubkey === nostrStore.pubkey;
    }

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
      uploadedFileNames.push(file.name);

      // Add file to tree immediately after upload completes
      const currentAppState = useAppStore.getState();

      if (currentAppState.rootHash) {
        // Add to existing tree
        const newRootHash = await tree.setEntry(
          currentAppState.rootHash,
          dirPath,
          file.name,
          hash,
          size
        );
        currentAppState.setRootHash(newRootHash);
        // Mark this file as changed for pulse effect
        markFilesChanged(new Set([file.name]));
      } else if (needsTreeInit) {
        // First file in a new virtual directory - create the tree
        const newRootHash = await tree.putDirectory([{ name: file.name, hash, size }]);
        currentAppState.setRootHash(newRootHash);
        markFilesChanged(new Set([file.name]));

        if (isOwnTree && routePubkey) {
          // Save to nostr and set up for autosave
          const hashHex = toHex(newRootHash);
          await saveHashtree(route.treeName!, hashHex);
          useNostrStore.getState().setSelectedTree({
            id: '',
            name: route.treeName!,
            pubkey: routePubkey,
            rootHash: hashHex,
            created_at: Math.floor(Date.now() / 1000),
          });
        }
        needsTreeInit = false; // Tree is now initialized
      } else {
        // No existing tree and not a virtual directory - create new root
        const newRootHash = await tree.putDirectory([{ name: file.name, hash, size }]);
        currentAppState.setRootHash(newRootHash);
        markFilesChanged(new Set([file.name]));
        if (i === 0) {
          navigate('/');
        }
      }
    }

    // Autosave after all uploads complete (single save instead of per-file)
    const finalAppState = useAppStore.getState();
    if (finalAppState.rootHash) {
      await autosaveIfOwn(toHex(finalAppState.rootHash));
    }

    setUploadProgress(null);

    // If single file uploaded, navigate to it
    if (uploadedFileNames.length === 1) {
      const currentRoute = parseRoute();
      const fileName = uploadedFileNames[0];

      if (currentRoute.npub && currentRoute.treeName) {
        // Tree route: /npub/treeName/path/filename
        const parts = [currentRoute.npub, currentRoute.treeName, ...dirPath, fileName];
        navigate('/' + parts.map(encodeURIComponent).join('/'));
      } else if (currentRoute.hash) {
        // Hash route: /nhash1.../path/filename
        const nhash = nhashEncode(currentRoute.hash);
        const parts = [nhash, ...dirPath, fileName];
        navigate('/' + parts.map(encodeURIComponent).join('/'));
      }
    }
  }, []);

  return { uploadProgress: progress, uploadFiles };
}
