/**
 * Directory reading utilities for browser File System Access API
 * Supports both webkitdirectory file inputs and drag-and-drop directories
 */

export interface FileWithPath {
  file: File;
  /** Relative path from the dropped/selected directory root */
  relativePath: string;
}

/**
 * Read files from a FileList that was selected via input[webkitdirectory]
 * Files already have webkitRelativePath set by the browser
 */
export function readFilesFromWebkitDirectory(files: FileList): FileWithPath[] {
  const result: FileWithPath[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file) continue;

    // webkitRelativePath includes the root directory name, e.g., "mydir/subdir/file.txt"
    // We want to keep that structure
    const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;

    result.push({ file, relativePath });
  }

  return result;
}

/**
 * Check if a DataTransfer contains directory items
 */
export function hasDirectoryItems(dataTransfer: DataTransfer): boolean {
  if (!dataTransfer.items) return false;

  for (let i = 0; i < dataTransfer.items.length; i++) {
    const item = dataTransfer.items[i];
    if (item?.kind === 'file') {
      const entry = item.webkitGetAsEntry?.();
      if (entry?.isDirectory) return true;
    }
  }

  return false;
}

/**
 * Read all files from a FileSystemEntry recursively
 */
async function readEntry(entry: FileSystemEntry, basePath: string): Promise<FileWithPath[]> {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry;
    const file = await new Promise<File>((resolve, reject) => {
      fileEntry.file(resolve, reject);
    });
    return [{ file, relativePath: basePath }];
  }

  if (entry.isDirectory) {
    const dirEntry = entry as FileSystemDirectoryEntry;
    const reader = dirEntry.createReader();
    const results: FileWithPath[] = [];

    // readEntries may not return all entries at once, so we need to call it repeatedly
    let entries: FileSystemEntry[] = [];
    do {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
        reader.readEntries(resolve, reject);
      });
      entries = batch;

      for (const childEntry of entries) {
        const childPath = basePath ? `${basePath}/${childEntry.name}` : childEntry.name;
        const childFiles = await readEntry(childEntry, childPath);
        results.push(...childFiles);
      }
    } while (entries.length > 0);

    return results;
  }

  return [];
}

/**
 * Read files from drag-and-drop DataTransfer, supporting directories
 * Uses webkitGetAsEntry() for directory access
 */
export async function readFilesFromDataTransfer(dataTransfer: DataTransfer): Promise<FileWithPath[]> {
  const results: FileWithPath[] = [];

  // Check if we have the directory-capable API
  if (dataTransfer.items) {
    for (let i = 0; i < dataTransfer.items.length; i++) {
      const item = dataTransfer.items[i];
      if (item?.kind !== 'file') continue;

      const entry = item.webkitGetAsEntry?.();
      if (entry) {
        // Use entry API for potentially directory support
        const files = await readEntry(entry, entry.name);
        results.push(...files);
      } else {
        // Fallback to regular file
        const file = item.getAsFile();
        if (file) {
          results.push({ file, relativePath: file.name });
        }
      }
    }
  } else if (dataTransfer.files) {
    // Fallback for browsers without items API
    for (let i = 0; i < dataTransfer.files.length; i++) {
      const file = dataTransfer.files[i];
      if (file) {
        results.push({ file, relativePath: file.name });
      }
    }
  }

  return results;
}

/**
 * Check if browser supports directory upload via webkitdirectory
 */
export function supportsDirectoryUpload(): boolean {
  // Check if the webkitdirectory attribute is supported
  const input = document.createElement('input');
  return 'webkitdirectory' in input;
}
