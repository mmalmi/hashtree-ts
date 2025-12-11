/**
 * Modal state management using Svelte stores
 */
import { writable } from 'svelte/store';
import type { CID, TreeVisibility } from 'hashtree';
import type { FileWithPath } from '../utils/directory';

type ModalType = 'file' | 'folder' | 'tree' | 'document';

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
  onDecision: (gitignore: boolean, rememberGlobally: boolean) => void;
}

interface GitHistoryTarget {
  dirCid: CID;
  canEdit: boolean;
  onCheckout?: (commitSha: string) => Promise<void>;
}

interface CollaboratorsTarget {
  /** Current list of collaborator npubs */
  npubs: string[];
  /** Callback to save changes (undefined = read-only mode) */
  onSave?: (npubs: string[]) => void;
}

interface UnsavedChangesTarget {
  /** Callback when user chooses Save */
  onSave: () => Promise<void> | void;
  /** Callback when user chooses Don't Save */
  onDiscard: () => void;
  /** Optional filename for display */
  fileName?: string;
}


interface ModalState {
  showCreateModal: boolean;
  createModalType: ModalType;
  createTreeVisibility: TreeVisibility;
  showRenameModal: boolean;
  renameTarget: string;
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
  showCollaboratorsModal: boolean;
  collaboratorsTarget: CollaboratorsTarget | null;
  showUnsavedChangesModal: boolean;
  unsavedChangesTarget: UnsavedChangesTarget | null;
  modalInput: string;
}

const initialState: ModalState = {
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
  showCollaboratorsModal: false,
  collaboratorsTarget: null,
  showUnsavedChangesModal: false,
  unsavedChangesTarget: null,
  modalInput: '',
};

// Svelte store
export const modalsStore = writable<ModalState>(initialState);

// Actions
export function openCreateModal(type: ModalType) {
  modalsStore.update(s => ({ ...s, showCreateModal: true, createModalType: type, createTreeVisibility: 'public', modalInput: '' }));
}

export function closeCreateModal() {
  modalsStore.update(s => ({ ...s, showCreateModal: false, createTreeVisibility: 'public', modalInput: '' }));
}

export function setCreateTreeVisibility(visibility: TreeVisibility) {
  modalsStore.update(s => ({ ...s, createTreeVisibility: visibility }));
}

export function openRenameModal(currentName: string) {
  modalsStore.update(s => ({ ...s, showRenameModal: true, renameTarget: currentName, modalInput: currentName }));
}

export function closeRenameModal() {
  modalsStore.update(s => ({ ...s, showRenameModal: false, renameTarget: '', modalInput: '' }));
}

export function openForkModal(dirCid: CID, suggestedName: string) {
  modalsStore.update(s => ({ ...s, showForkModal: true, forkTarget: { dirCid, suggestedName }, modalInput: suggestedName }));
}

export function closeForkModal() {
  modalsStore.update(s => ({ ...s, showForkModal: false, forkTarget: null, modalInput: '' }));
}

export function openExtractModal(archiveName: string, files: ArchiveFile[], originalData?: Uint8Array) {
  modalsStore.update(s => ({ ...s, showExtractModal: true, extractTarget: { archiveName, files, originalData }, extractLocation: 'subdir', modalInput: '' }));
}

export function closeExtractModal() {
  modalsStore.update(s => ({ ...s, showExtractModal: false, extractTarget: null, extractLocation: 'current', modalInput: '' }));
}

export function setExtractLocation(location: ExtractLocation) {
  modalsStore.update(s => ({ ...s, extractLocation: location }));
}

export function openGitignoreModal(target: GitignoreTarget) {
  modalsStore.update(s => ({ ...s, showGitignoreModal: true, gitignoreTarget: target }));
}

export function closeGitignoreModal() {
  modalsStore.update(s => ({ ...s, showGitignoreModal: false, gitignoreTarget: null }));
}

export function openGitHistoryModal(dirCid: CID, canEdit: boolean = false, onCheckout?: (commitSha: string) => Promise<void>) {
  modalsStore.update(s => ({ ...s, showGitHistoryModal: true, gitHistoryTarget: { dirCid, canEdit, onCheckout } }));
}

export function closeGitHistoryModal() {
  modalsStore.update(s => ({ ...s, showGitHistoryModal: false, gitHistoryTarget: null }));
}

export function openShareModal(url: string) {
  modalsStore.update(s => ({ ...s, showShareModal: true, shareUrl: url }));
}

export function closeShareModal() {
  modalsStore.update(s => ({ ...s, showShareModal: false, shareUrl: null }));
}

export function openCollaboratorsModal(npubs: string[], onSave?: (npubs: string[]) => void) {
  modalsStore.update(s => ({ ...s, showCollaboratorsModal: true, collaboratorsTarget: { npubs, onSave } }));
}

export function closeCollaboratorsModal() {
  modalsStore.update(s => ({ ...s, showCollaboratorsModal: false, collaboratorsTarget: null }));
}

export function openUnsavedChangesModal(target: UnsavedChangesTarget) {
  modalsStore.update(s => ({ ...s, showUnsavedChangesModal: true, unsavedChangesTarget: target }));
}

export function closeUnsavedChangesModal() {
  modalsStore.update(s => ({ ...s, showUnsavedChangesModal: false, unsavedChangesTarget: null }));
}

export function setModalInput(input: string) {
  modalsStore.update(s => ({ ...s, modalInput: input }));
}

export type { ArchiveFile, ExtractTarget, ExtractLocation, GitignoreTarget, GitHistoryTarget, CollaboratorsTarget, UnsavedChangesTarget };
