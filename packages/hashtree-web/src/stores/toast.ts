/**
 * Toast notification store
 * Manages toast messages with auto-dismiss
 */
import { useSyncExternalStore } from 'react';

export type ToastType = 'info' | 'success' | 'error' | 'warning';

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number; // ms, undefined = no auto-dismiss
}

// Module-level state
let toasts: Toast[] = [];
let nextId = 1;

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach(l => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return toasts;
}

export function useToasts() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function showToast(type: ToastType, message: string, duration = 4000): string {
  const id = String(nextId++);
  const toast: Toast = { id, type, message, duration };
  toasts = [...toasts, toast];
  emit();

  if (duration > 0) {
    setTimeout(() => dismissToast(id), duration);
  }

  return id;
}

export function dismissToast(id: string) {
  toasts = toasts.filter(t => t.id !== id);
  emit();
}

// Convenience functions
export const toast = {
  info: (message: string, duration?: number) => showToast('info', message, duration),
  success: (message: string, duration?: number) => showToast('success', message, duration),
  error: (message: string, duration?: number) => showToast('error', message, duration ?? 6000),
  warning: (message: string, duration?: number) => showToast('warning', message, duration),
};
