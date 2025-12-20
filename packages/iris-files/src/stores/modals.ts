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

interface ArchiveFileInfo {
  name: string;
  size: number;
}

interface ExtractTarget {
  archiveName: string;
  files: ArchiveFileInfo[];  // File list without data
  archiveData: Uint8Array;   // Original ZIP for extraction and "Keep as ZIP"
  commonRoot: string | null; // If all files share a common root directory
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

interface GitShellTarget {
  dirCid: CID;
  /** Whether write commands are allowed (requires canEdit) */
  canEdit?: boolean;
  /** Callback when changes are made to the repo (receives new dirCid) */
  onChange?: (newDirCid: CID) => void;
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

interface NewPullRequestTarget {
  npub: string;
  repoName: string;
  /** Available branches in the repo */
  branches?: string[];
  /** Currently checked out branch (pre-selected as source) */
  currentBranch?: string;
  /** Callback when PR is created */
  onCreate?: (pr: { id: string; title: string }) => void;
}

interface NewIssueTarget {
  npub: string;
  repoName: string;
  /** Callback when issue is created */
  onCreate?: (issue: { id: string; title: string }) => void;
}

interface GitCommitTarget {
  dirCid: CID;
  /** Callback when commit is created */
  onCommit?: (newDirCid: CID) => Promise<void>;
}

interface BlossomPushTarget {
  /** Directory or file CID to push */
  cid: CID;
  /** Name of the directory/file for display */
  name: string;
  /** Whether this is a directory (recursive) or single file */
  isDirectory: boolean;
}

interface AddToPlaylistTarget {
  /** CID of the video to add (includes hash + key for unlisted) */
  videoCid: CID;
  /** Title of the video (for display) */
  videoTitle: string;
  /** Size of the video directory */
  videoSize: number;
}

type VideoUploadTab = 'upload' | 'stream';

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
  showGitShellModal: boolean;
  gitShellTarget: GitShellTarget | null;
  showShareModal: boolean;
  shareUrl: string | null;
  showCollaboratorsModal: boolean;
  collaboratorsTarget: CollaboratorsTarget | null;
  showUnsavedChangesModal: boolean;
  unsavedChangesTarget: UnsavedChangesTarget | null;
  showNewPullRequestModal: boolean;
  newPullRequestTarget: NewPullRequestTarget | null;
  showNewIssueModal: boolean;
  newIssueTarget: NewIssueTarget | null;
  showGitCommitModal: boolean;
  gitCommitTarget: GitCommitTarget | null;
  showBlossomPushModal: boolean;
  blossomPushTarget: BlossomPushTarget | null;
  showVideoUploadModal: boolean;
  videoUploadTab: VideoUploadTab;
  showAddToPlaylistModal: boolean;
  addToPlaylistTarget: AddToPlaylistTarget | null;
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
  showGitShellModal: false,
  gitShellTarget: null,
  showShareModal: false,
  shareUrl: null,
  showCollaboratorsModal: false,
  collaboratorsTarget: null,
  showUnsavedChangesModal: false,
  unsavedChangesTarget: null,
  showNewPullRequestModal: false,
  newPullRequestTarget: null,
  showNewIssueModal: false,
  newIssueTarget: null,
  showGitCommitModal: false,
  gitCommitTarget: null,
  showBlossomPushModal: false,
  blossomPushTarget: null,
  showVideoUploadModal: false,
  videoUploadTab: 'upload',
  showAddToPlaylistModal: false,
  addToPlaylistTarget: null,
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

export function openExtractModal(archiveName: string, files: ArchiveFileInfo[], archiveData: Uint8Array, commonRoot: string | null = null) {
  // If files already have a common root, default to extracting to current directory
  // (since the subdirectory already exists in the file paths)
  const defaultLocation: ExtractLocation = commonRoot ? 'current' : 'subdir';
  modalsStore.update(s => ({ ...s, showExtractModal: true, extractTarget: { archiveName, files, archiveData, commonRoot }, extractLocation: defaultLocation, modalInput: '' }));
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

export function openGitShellModal(dirCid: CID, canEdit?: boolean, onChange?: (newDirCid: CID) => void) {
  modalsStore.update(s => ({ ...s, showGitShellModal: true, gitShellTarget: { dirCid, canEdit, onChange } }));
}

export function closeGitShellModal() {
  modalsStore.update(s => ({ ...s, showGitShellModal: false, gitShellTarget: null }));
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

export function updateCollaboratorsModal(npubs: string[]) {
  modalsStore.update(s => {
    if (!s.showCollaboratorsModal || !s.collaboratorsTarget) return s;
    return { ...s, collaboratorsTarget: { ...s.collaboratorsTarget, npubs } };
  });
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

export function openNewPullRequestModal(
  npub: string,
  repoName: string,
  options?: {
    branches?: string[];
    currentBranch?: string;
    onCreate?: (pr: { id: string; title: string }) => void;
  }
) {
  modalsStore.update(s => ({
    ...s,
    showNewPullRequestModal: true,
    newPullRequestTarget: {
      npub,
      repoName,
      branches: options?.branches,
      currentBranch: options?.currentBranch,
      onCreate: options?.onCreate,
    },
    modalInput: '',
  }));
}

export function closeNewPullRequestModal() {
  modalsStore.update(s => ({ ...s, showNewPullRequestModal: false, newPullRequestTarget: null, modalInput: '' }));
}

export function openNewIssueModal(npub: string, repoName: string, onCreate?: (issue: { id: string; title: string }) => void) {
  modalsStore.update(s => ({ ...s, showNewIssueModal: true, newIssueTarget: { npub, repoName, onCreate }, modalInput: '' }));
}

export function closeNewIssueModal() {
  modalsStore.update(s => ({ ...s, showNewIssueModal: false, newIssueTarget: null, modalInput: '' }));
}

export function openGitCommitModal(dirCid: CID, onCommit?: (newDirCid: CID) => Promise<void>) {
  modalsStore.update(s => ({ ...s, showGitCommitModal: true, gitCommitTarget: { dirCid, onCommit }, modalInput: '' }));
}

export function closeGitCommitModal() {
  modalsStore.update(s => ({ ...s, showGitCommitModal: false, gitCommitTarget: null, modalInput: '' }));
}

export function openBlossomPushModal(cid: CID, name: string, isDirectory: boolean) {
  modalsStore.update(s => ({ ...s, showBlossomPushModal: true, blossomPushTarget: { cid, name, isDirectory } }));
}

export function closeBlossomPushModal() {
  modalsStore.update(s => ({ ...s, showBlossomPushModal: false, blossomPushTarget: null }));
}

export function openVideoUploadModal(tab: VideoUploadTab = 'upload') {
  modalsStore.update(s => ({ ...s, showVideoUploadModal: true, videoUploadTab: tab }));
}

export function closeVideoUploadModal() {
  modalsStore.update(s => ({ ...s, showVideoUploadModal: false, videoUploadTab: 'upload' }));
}

export function setVideoUploadTab(tab: VideoUploadTab) {
  modalsStore.update(s => ({ ...s, videoUploadTab: tab }));
}

export function openAddToPlaylistModal(videoCid: CID, videoTitle: string, videoSize: number) {
  modalsStore.update(s => ({ ...s, showAddToPlaylistModal: true, addToPlaylistTarget: { videoCid, videoTitle, videoSize }, modalInput: '' }));
}

export function closeAddToPlaylistModal() {
  modalsStore.update(s => ({ ...s, showAddToPlaylistModal: false, addToPlaylistTarget: null, modalInput: '' }));
}

export type { ArchiveFileInfo, ExtractTarget, ExtractLocation, GitignoreTarget, GitHistoryTarget, GitShellTarget, CollaboratorsTarget, UnsavedChangesTarget, NewPullRequestTarget, NewIssueTarget, GitCommitTarget, BlossomPushTarget, VideoUploadTab, AddToPlaylistTarget };
