/**
 * Modal state management using module-level store
 */
import { useSyncExternalStore } from 'react';
import type { CID, TreeVisibility } from 'hashtree';
import type { FileWithPath } from '../utils/directory';

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
  originalData?: Uint8Array; // Original ZIP data for "Keep as ZIP" option
}

type ExtractLocation = 'current' | 'subdir';

interface GitignoreTarget {
  /** All files from the directory */
  allFiles: FileWithPath[];
  /** Files that would be included (not ignored) */
  includedFiles: FileWithPath[];
  /** Files that would be excluded (ignored) */
  excludedFiles: FileWithPath[];
  /** Root directory name */
  dirName: string;
  /** Callback when user makes a decision */
  onDecision: (useGitignore: boolean, rememberGlobally: boolean) => void;
}

interface GitHistoryTarget {
  dirCid: CID;
}


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
  showGitignoreModal: boolean;
  gitignoreTarget: GitignoreTarget | null;
  showGitHistoryModal: boolean;
  gitHistoryTarget: GitHistoryTarget | null;
  showShareModal: boolean;
  shareUrl: string | null;
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
  extractLocation: 'subdir',
  showGitignoreModal: false,
  gitignoreTarget: null,
  showGitHistoryModal: false,
  gitHistoryTarget: null,
  showShareModal: false,
  shareUrl: null,
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

export function openExtractModal(archiveName: string, files: ArchiveFile[], originalData?: Uint8Array) {
  state = { ...state, showExtractModal: true, extractTarget: { archiveName, files, originalData }, extractLocation: 'subdir', modalInput: '' };
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

export function openGitignoreModal(target: GitignoreTarget) {
  state = { ...state, showGitignoreModal: true, gitignoreTarget: target };
  emit();
}

export function closeGitignoreModal() {
  state = { ...state, showGitignoreModal: false, gitignoreTarget: null };
  emit();
}

export function openGitHistoryModal(dirCid: CID) {
  state = { ...state, showGitHistoryModal: true, gitHistoryTarget: { dirCid } };
  emit();
}

export function closeGitHistoryModal() {
  state = { ...state, showGitHistoryModal: false, gitHistoryTarget: null };
  emit();
}

export function openShareModal(url: string) {
  state = { ...state, showShareModal: true, shareUrl: url };
  emit();
}

export function closeShareModal() {
  state = { ...state, showShareModal: false, shareUrl: null };
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
    openGitignoreModal,
    closeGitignoreModal,
    openGitHistoryModal,
    closeGitHistoryModal,
    openShareModal,
    closeShareModal,
    setModalInput,
  };
}

export type { ArchiveFile, ExtractTarget, ExtractLocation, GitignoreTarget, GitHistoryTarget };
