/**
 * Upload hook - manages file upload with progress tracking
 * Uses module-level state pattern for lightweight state management
 *
 * All uploads use encryption by default (CHK - Content Hash Key).
 */
import { useSyncExternalStore, useCallback } from 'react';
import { toHex, nhashEncode } from 'hashtree';
import { useAppStore, getTree } from '../store';
import { autosaveIfOwn, saveHashtree, useNostrStore } from '../nostr';
import { navigate } from '../utils/navigate';
import { getCurrentPathFromUrl, parseRoute } from '../utils/route';
import { clearFileSelection } from '../actions';
import { markFilesChanged } from './useRecentlyChanged';
import { openExtractModal, type ArchiveFile } from './useModals';
import { isArchiveFile, extractArchive } from '../utils/compression';
import { nip19 } from 'nostr-tools';
import type { FileWithPath } from '../utils/directory';

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
let uploadCancelled = false;

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

/**
 * Cancel any in-progress upload
 */
export function cancelUpload() {
  uploadCancelled = true;
  setUploadProgress(null);
}

/**
 * Check if upload was cancelled and reset flag
 */
function checkCancelled(): boolean {
  if (uploadCancelled) {
    uploadCancelled = false;
    return true;
  }
  return false;
}

export function useUpload() {
  const progress = useUploadProgress();

  const uploadFiles = useCallback(async (files: FileList): Promise<void> => {
    if (!files.length) return;

    // Reset cancellation flag at start
    uploadCancelled = false;

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
    let needsTreeInit = !appState.rootCid?.hash && route.npub && route.treeName;
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
      // Check for cancellation at start of each file
      if (checkCancelled()) return;

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

      // Check if this is an archive file and offer to extract
      if (isArchiveFile(file.name)) {
        try {
          const extractedFiles = extractArchive(data, file.name);
          if (extractedFiles.length > 0) {
            // Convert to ArchiveFile format and show modal
            const archiveFiles: ArchiveFile[] = extractedFiles.map(f => ({
              name: f.name,
              data: f.data,
              size: f.data.length,
            }));
            setUploadProgress(null);
            openExtractModal(file.name, archiveFiles);
            // Don't continue with normal upload - the modal will handle it
            return;
          }
        } catch (err) {
          console.warn('Failed to parse archive, uploading as regular file:', err);
          // Fall through to normal upload
        }
      }

      // Use encrypted file storage (default)
      const { cid: fileCid, size } = await tree.putFile(data);
      uploadedFileNames.push(file.name);

      // Add file to tree immediately after upload completes
      const currentAppState = useAppStore.getState();

      if (currentAppState.rootCid?.hash) {
        // Add to existing tree - setEntry handles encryption based on rootCid.key
        const newRootCid = await tree.setEntry(
          currentAppState.rootCid,
          dirPath,
          file.name,
          fileCid,
          size
        );
        currentAppState.setRootCid(newRootCid);
        // Mark this file as changed for pulse effect
        markFilesChanged(new Set([file.name]));
      } else if (needsTreeInit) {
        // First file in a new virtual directory - create encrypted tree
        const { cid: newRootCid } = await tree.putDirectory([{ name: file.name, cid: fileCid, size }]);
        currentAppState.setRootCid(newRootCid);
        markFilesChanged(new Set([file.name]));

        if (isOwnTree && routePubkey) {
          // Save to nostr and set up for autosave
          const hashHex = toHex(newRootCid.hash);
          const keyHex = newRootCid.key ? toHex(newRootCid.key) : undefined;
          await saveHashtree(route.treeName!, hashHex, keyHex);
          useNostrStore.getState().setSelectedTree({
            id: '',
            name: route.treeName!,
            pubkey: routePubkey,
            rootHash: hashHex,
            rootKey: keyHex,
            created_at: Math.floor(Date.now() / 1000),
          });
        }
        needsTreeInit = false; // Tree is now initialized
      } else {
        // No existing tree and not a virtual directory - create new encrypted root
        const { cid: newRootCid } = await tree.putDirectory([{ name: file.name, cid: fileCid, size }]);
        currentAppState.setRootCid(newRootCid);
        markFilesChanged(new Set([file.name]));
        if (i === 0) {
          navigate('/');
        }
      }
    }

    // Autosave after all uploads complete (single save instead of per-file)
    const finalAppState = useAppStore.getState();
    if (finalAppState.rootCid?.hash) {
      const keyHex = finalAppState.rootCid.key ? toHex(finalAppState.rootCid.key) : undefined;
      await autosaveIfOwn(toHex(finalAppState.rootCid.hash), keyHex);
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

  /**
   * Upload files with path information (for directory uploads)
   * Files are uploaded with their relative paths preserved in the tree structure
   */
  const uploadFilesWithPaths = useCallback(async (filesWithPaths: FileWithPath[]): Promise<void> => {
    if (!filesWithPaths.length) return;

    // Reset cancellation flag at start
    uploadCancelled = false;

    // Clear selected file so upload indicator is visible
    clearFileSelection();

    const total = filesWithPaths.length;
    const uploadedFileNames: string[] = [];
    const tree = getTree();
    const route = parseRoute();
    const dirPath = getCurrentPathFromUrl();

    // Check if we need to initialize a new tree
    const appState = useAppStore.getState();
    let needsTreeInit = !appState.rootCid?.hash && route.npub && route.treeName;
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

    for (let i = 0; i < filesWithPaths.length; i++) {
      // Check for cancellation at start of each file
      if (checkCancelled()) return;

      const { file, relativePath } = filesWithPaths[i];
      if (!file) continue;
      const totalBytes = file.size;

      setUploadProgress({
        current: i + 1,
        total,
        fileName: relativePath,
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
          fileName: relativePath,
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

      // Store the file with encryption (default)
      const { cid: fileCid, size } = await tree.putFile(data);

      // Parse the relative path to get directory components and filename
      const pathParts = relativePath.split('/');
      const fileName = pathParts.pop()!;
      const fileDirPath = pathParts; // Directory path within the uploaded structure

      // Combine with current directory path
      const fullDirPath = [...dirPath, ...fileDirPath];

      uploadedFileNames.push(relativePath);

      // Add file to tree
      const currentAppState = useAppStore.getState();

      try {
        if (currentAppState.rootCid?.hash) {
          // Add to existing tree with full path - setEntry handles encryption based on rootCid.key
          // and creates intermediate directories automatically
          const newRootCid = await tree.setEntry(
            currentAppState.rootCid,
            fullDirPath,
            fileName,
            fileCid,
            size
          );
          currentAppState.setRootCid(newRootCid);

          // Mark this file as changed for pulse effect (use just filename for display in current dir)
          if (fileDirPath.length === 0) {
            markFilesChanged(new Set([fileName]));
          }
        } else if (needsTreeInit) {
          // First file in a new virtual directory - create encrypted tree
          const { cid: rootCidVal } = await tree.putDirectory([]);

          // Use setEntry to add nested directories and file
          const newRootCid = await tree.setEntry(
            rootCidVal,
            fullDirPath,
            fileName,
            fileCid,
            size
          );

          currentAppState.setRootCid(newRootCid);

          if (isOwnTree && routePubkey) {
            const hashHex = toHex(newRootCid.hash);
            const keyHex = newRootCid.key ? toHex(newRootCid.key) : undefined;
            await saveHashtree(route.treeName!, hashHex, keyHex);
            useNostrStore.getState().setSelectedTree({
              id: '',
              name: route.treeName!,
              pubkey: routePubkey,
              rootHash: hashHex,
              rootKey: keyHex,
              created_at: Math.floor(Date.now() / 1000),
            });
          }
          needsTreeInit = false;
        } else {
          // No existing tree - create new encrypted root with this file
          const { cid: rootCidVal } = await tree.putDirectory([]);

          // Use setEntry to add nested directories and file
          const newRootCid = await tree.setEntry(
            rootCidVal,
            fullDirPath,
            fileName,
            fileCid,
            size
          );

          currentAppState.setRootCid(newRootCid);
          if (i === 0) {
            navigate('/');
          }
        }
      } catch (err) {
        console.error(`Failed to add file ${relativePath}:`, err);
        // Continue with next file instead of stopping entirely
      }
    }

    // Autosave after all uploads complete
    const finalAppState = useAppStore.getState();
    if (finalAppState.rootCid?.hash) {
      const keyHex = finalAppState.rootCid.key ? toHex(finalAppState.rootCid.key) : undefined;
      await autosaveIfOwn(toHex(finalAppState.rootCid.hash), keyHex);
    }

    setUploadProgress(null);
  }, []);

  return { uploadProgress: progress, uploadFiles, uploadFilesWithPaths, cancelUpload };
}
