/**
 * File-related modals: create, rename, fork, extract
 */
import type { CID, TreeVisibility } from 'hashtree';
import { modalsStore, type ModalType, type ArchiveFileInfo, type ExtractLocation } from './store';

// ========== Create Modal ==========

export function openCreateModal(type: ModalType) {
  modalsStore.update(s => ({
    ...s,
    showCreateModal: true,
    createModalType: type,
    createTreeVisibility: 'public',
    modalInput: '',
  }));
}

export function closeCreateModal() {
  modalsStore.update(s => ({
    ...s,
    showCreateModal: false,
    createTreeVisibility: 'public',
    modalInput: '',
  }));
}

export function setCreateTreeVisibility(visibility: TreeVisibility) {
  modalsStore.update(s => ({ ...s, createTreeVisibility: visibility }));
}

// ========== Rename Modal ==========

export function openRenameModal(currentName: string) {
  modalsStore.update(s => ({
    ...s,
    showRenameModal: true,
    renameTarget: currentName,
    modalInput: currentName,
  }));
}

export function closeRenameModal() {
  modalsStore.update(s => ({
    ...s,
    showRenameModal: false,
    renameTarget: '',
    modalInput: '',
  }));
}

// ========== Fork Modal ==========

export function openForkModal(dirCid: CID, suggestedName: string) {
  modalsStore.update(s => ({
    ...s,
    showForkModal: true,
    forkTarget: { dirCid, suggestedName },
    modalInput: suggestedName,
  }));
}

export function closeForkModal() {
  modalsStore.update(s => ({
    ...s,
    showForkModal: false,
    forkTarget: null,
    modalInput: '',
  }));
}

// ========== Extract Modal ==========

export function openExtractModal(
  archiveName: string,
  files: ArchiveFileInfo[],
  archiveData: Uint8Array,
  commonRoot: string | null = null
) {
  const defaultLocation: ExtractLocation = commonRoot ? 'current' : 'subdir';
  modalsStore.update(s => ({
    ...s,
    showExtractModal: true,
    extractTarget: { archiveName, files, archiveData, commonRoot },
    extractLocation: defaultLocation,
    modalInput: '',
  }));
}

export function closeExtractModal() {
  modalsStore.update(s => ({
    ...s,
    showExtractModal: false,
    extractTarget: null,
    extractLocation: 'current',
    modalInput: '',
  }));
}

export function setExtractLocation(location: ExtractLocation) {
  modalsStore.update(s => ({ ...s, extractLocation: location }));
}
