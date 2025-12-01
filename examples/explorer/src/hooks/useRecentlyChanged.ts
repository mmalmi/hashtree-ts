/**
 * Hook for managing recently changed files (for pulse animation)
 * Uses a simple module-level store to avoid global appStore bloat
 */
import { useSyncExternalStore } from 'react';

// Module-level state
let recentlyChangedFiles: Set<string> = new Set();
const listeners = new Set<() => void>();

// Per-file timers - when a file is re-marked, we cancel the old timer
const fileTimers = new Map<string, ReturnType<typeof setTimeout>>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return recentlyChangedFiles;
}

function setRecentlyChangedFiles(files: Set<string>) {
  recentlyChangedFiles = files;
  listeners.forEach(l => l());
}

// Clear a single file after delay
function clearFileAfterDelay(fileName: string, delayMs: number) {
  // Cancel existing timer for this file if any
  const existingTimer = fileTimers.get(fileName);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  // Set new timer
  const timer = setTimeout(() => {
    fileTimers.delete(fileName);
    const current = recentlyChangedFiles;
    if (current.has(fileName)) {
      const remaining = new Set([...current].filter(f => f !== fileName));
      setRecentlyChangedFiles(remaining);
    }
  }, delayMs);

  fileTimers.set(fileName, timer);
}

/**
 * Mark files as recently changed (triggers pulse animation in FileBrowser)
 * Files are automatically cleared after 5 seconds
 * If a file is marked again before timeout, the timer resets
 */
export function markFilesChanged(fileNames: Set<string>) {
  const merged = new Set([...recentlyChangedFiles, ...fileNames]);
  setRecentlyChangedFiles(merged);

  // Set individual timers for each file (resets if already set)
  for (const fileName of fileNames) {
    clearFileAfterDelay(fileName, 5000);
  }
}

/**
 * Hook to read recently changed files state
 */
export function useRecentlyChanged() {
  const files = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return files;
}
