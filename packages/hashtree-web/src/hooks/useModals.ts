/**
 * Modal state management using module-level store
 */
import { useSyncExternalStore } from 'react';
import type { CID } from 'hashtree';

type ModalType = 'file' | 'folder' | 'tree';

interface ForkTarget {
  dirCid: CID;
  suggestedName: string;
}

interface ArchiveFile {
  name: string;
  data: Uint8Array;
  size: number;
}

interface ExtractTarget {
  archiveName: string;
  files: ArchiveFile[];
}

interface ModalState {
  showCreateModal: boolean;
  createModalType: ModalType;
  showRenameModal: boolean;
  renameTarget: string; // Original name of item being renamed
  showForkModal: boolean;
  forkTarget: ForkTarget | null;
  showExtractModal: boolean;
  extractTarget: ExtractTarget | null;
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
  showExtractModal: false,
  extractTarget: null,
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

export function openForkModal(dirCid: CID, suggestedName: string) {
  state = { ...state, showForkModal: true, forkTarget: { dirCid, suggestedName }, modalInput: suggestedName };
  emit();
}

export function closeForkModal() {
  state = { ...state, showForkModal: false, forkTarget: null, modalInput: '' };
  emit();
}

export function openExtractModal(archiveName: string, files: ArchiveFile[]) {
  state = { ...state, showExtractModal: true, extractTarget: { archiveName, files }, modalInput: '' };
  emit();
}

export function closeExtractModal() {
  state = { ...state, showExtractModal: false, extractTarget: null, modalInput: '' };
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
    openExtractModal,
    closeExtractModal,
    setModalInput,
  };
}

export type { ArchiveFile, ExtractTarget };
