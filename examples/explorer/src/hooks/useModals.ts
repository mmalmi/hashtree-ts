/**
 * Modal state management using module-level store
 */
import { useSyncExternalStore } from 'react';

type ModalType = 'file' | 'folder' | 'tree';

interface ModalState {
  showCreateModal: boolean;
  createModalType: ModalType;
  showRenameModal: boolean;
  modalInput: string;
}

// Module-level state
let state: ModalState = {
  showCreateModal: false,
  createModalType: 'file',
  showRenameModal: false,
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
  state = { ...state, showRenameModal: true, modalInput: currentName };
  emit();
}

export function closeRenameModal() {
  state = { ...state, showRenameModal: false, modalInput: '' };
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
    setModalInput,
  };
}
