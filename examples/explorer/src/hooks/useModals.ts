/**
 * Modal state management using module-level store
 */
import { useSyncExternalStore } from 'react';

type ModalType = 'file' | 'folder' | 'tree';

interface ForkTarget {
  dirHash: Uint8Array;
  suggestedName: string;
}

interface ModalState {
  showCreateModal: boolean;
  createModalType: ModalType;
  showRenameModal: boolean;
  renameTarget: string; // Original name of item being renamed
  showForkModal: boolean;
  forkTarget: ForkTarget | null;
  modalInput: string;
}

// Module-level state
let state: ModalState = {
  showCreateModal: false,
  createModalType: 'file',
  showRenameModal: false,
  renameTarget: '',
  showForkModal: false,
  forkTarget: null,
  modalInput: '',
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

// Actions
export function openCreateModal(type: ModalType) {
  state = { ...state, showCreateModal: true, createModalType: type, modalInput: '' };
  emit();
}

export function closeCreateModal() {
  state = { ...state, showCreateModal: false, modalInput: '' };
  emit();
}

export function openRenameModal(currentName: string) {
  state = { ...state, showRenameModal: true, renameTarget: currentName, modalInput: currentName };
  emit();
}

export function closeRenameModal() {
  state = { ...state, showRenameModal: false, renameTarget: '', modalInput: '' };
  emit();
}

export function openForkModal(dirHash: Uint8Array, suggestedName: string) {
  state = { ...state, showForkModal: true, forkTarget: { dirHash, suggestedName }, modalInput: suggestedName };
  emit();
}

export function closeForkModal() {
  state = { ...state, showForkModal: false, forkTarget: null, modalInput: '' };
  emit();
}

export function setModalInput(input: string) {
  state = { ...state, modalInput: input };
  emit();
}

/**
 * Hook to read modal state
 */
export function useModals() {
  const modalState = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return {
    ...modalState,
    openCreateModal,
    closeCreateModal,
    openRenameModal,
    closeRenameModal,
    openForkModal,
    closeForkModal,
    setModalInput,
  };
}
