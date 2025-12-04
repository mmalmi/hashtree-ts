/**
 * Modal state management using module-level store
 */
import { useSyncExternalStore } from 'react';
import type { CID, TreeVisibility } from 'hashtree';

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

type ExtractLocation = 'current' | 'subdir';

interface ModalState {
  showCreateModal: boolean;
  createModalType: ModalType;
  createTreeVisibility: TreeVisibility;
  showRenameModal: boolean;
  renameTarget: string; // Original name of item being renamed
  showForkModal: boolean;
  forkTarget: ForkTarget | null;
  showExtractModal: boolean;
  extractTarget: ExtractTarget | null;
  extractLocation: ExtractLocation;
  modalInput: string;
}

// Module-level state
let state: ModalState = {
  showCreateModal: false,
  createModalType: 'file',
  createTreeVisibility: 'public',
  showRenameModal: false,
  renameTarget: '',
  showForkModal: false,
  forkTarget: null,
  showExtractModal: false,
  extractTarget: null,
  extractLocation: 'current',
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
  state = { ...state, showCreateModal: true, createModalType: type, createTreeVisibility: 'public', modalInput: '' };
  emit();
}

export function closeCreateModal() {
  state = { ...state, showCreateModal: false, createTreeVisibility: 'public', modalInput: '' };
  emit();
}

export function setCreateTreeVisibility(visibility: TreeVisibility) {
  state = { ...state, createTreeVisibility: visibility };
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
  state = { ...state, showExtractModal: true, extractTarget: { archiveName, files }, extractLocation: 'current', modalInput: '' };
  emit();
}

export function closeExtractModal() {
  state = { ...state, showExtractModal: false, extractTarget: null, extractLocation: 'current', modalInput: '' };
  emit();
}

export function setExtractLocation(location: ExtractLocation) {
  state = { ...state, extractLocation: location };
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
    setCreateTreeVisibility,
    openRenameModal,
    closeRenameModal,
    openForkModal,
    closeForkModal,
    openExtractModal,
    closeExtractModal,
    setExtractLocation,
    setModalInput,
  };
}

export type { ArchiveFile, ExtractTarget, ExtractLocation };
