/**
 * Core modal store - shared state and utilities
 */
import { writable } from 'svelte/store';
import type { CID, TreeVisibility } from 'hashtree';
import type { FileWithPath } from '../../utils/directory';

// ========== Types ==========

export type ModalType = 'file' | 'folder' | 'tree' | 'document';
export type ExtractLocation = 'current' | 'subdir';
export type VideoUploadTab = 'upload' | 'stream';

export interface ArchiveFileInfo {
  name: string;
  size: number;
}

export interface ForkTarget {
  dirCid: CID;
  suggestedName: string;
}

export interface ExtractTarget {
  archiveName: string;
  files: ArchiveFileInfo[];
  archiveData: Uint8Array;
  commonRoot: string | null;
}

export interface GitignoreTarget {
  allFiles: FileWithPath[];
  includedFiles: FileWithPath[];
  excludedFiles: FileWithPath[];
  dirName: string;
  onDecision: (gitignore: boolean, rememberGlobally: boolean) => void;
}

export interface GitHistoryTarget {
  dirCid: CID;
  canEdit: boolean;
  onCheckout?: (commitSha: string) => Promise<void>;
}

export interface GitShellTarget {
  dirCid: CID;
  canEdit?: boolean;
  onChange?: (newDirCid: CID) => void;
}

export interface CollaboratorsTarget {
  npubs: string[];
  onSave?: (npubs: string[]) => void;
}

export interface UnsavedChangesTarget {
  onSave: () => Promise<void> | void;
  onDiscard: () => void;
  fileName?: string;
}

export interface NewPullRequestTarget {
  npub: string;
  repoName: string;
  branches?: string[];
  currentBranch?: string;
  onCreate?: (pr: { id: string; title: string }) => void;
}

export interface NewIssueTarget {
  npub: string;
  repoName: string;
  onCreate?: (issue: { id: string; title: string }) => void;
}

export interface GitCommitTarget {
  dirCid: CID;
  onCommit?: (newDirCid: CID) => Promise<void>;
}

export interface BlossomPushTarget {
  cid: CID;
  name: string;
  isDirectory: boolean;
}

export interface AddToPlaylistTarget {
  /** CID of the video to add (includes hash + key for unlisted) */
  videoCid: CID;
  /** Title of the video (for display) */
  videoTitle: string;
  /** Size of the video directory */
  videoSize: number;
}

// ========== State ==========

export interface ModalState {
  // File modals
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

  // Git modals
  showGitignoreModal: boolean;
  gitignoreTarget: GitignoreTarget | null;
  showGitHistoryModal: boolean;
  gitHistoryTarget: GitHistoryTarget | null;
  showGitShellModal: boolean;
  gitShellTarget: GitShellTarget | null;
  showGitCommitModal: boolean;
  gitCommitTarget: GitCommitTarget | null;
  showNewPullRequestModal: boolean;
  newPullRequestTarget: NewPullRequestTarget | null;
  showNewIssueModal: boolean;
  newIssueTarget: NewIssueTarget | null;

  // Share modals
  showShareModal: boolean;
  shareUrl: string | null;
  showCollaboratorsModal: boolean;
  collaboratorsTarget: CollaboratorsTarget | null;
  showBlossomPushModal: boolean;
  blossomPushTarget: BlossomPushTarget | null;

  // Other modals
  showUnsavedChangesModal: boolean;
  unsavedChangesTarget: UnsavedChangesTarget | null;
  showVideoUploadModal: boolean;
  videoUploadTab: VideoUploadTab;
  showAddToPlaylistModal: boolean;
  addToPlaylistTarget: AddToPlaylistTarget | null;

  // Shared
  modalInput: string;
}

const initialState: ModalState = {
  // File modals
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

  // Git modals
  showGitignoreModal: false,
  gitignoreTarget: null,
  showGitHistoryModal: false,
  gitHistoryTarget: null,
  showGitShellModal: false,
  gitShellTarget: null,
  showGitCommitModal: false,
  gitCommitTarget: null,
  showNewPullRequestModal: false,
  newPullRequestTarget: null,
  showNewIssueModal: false,
  newIssueTarget: null,

  // Share modals
  showShareModal: false,
  shareUrl: null,
  showCollaboratorsModal: false,
  collaboratorsTarget: null,
  showBlossomPushModal: false,
  blossomPushTarget: null,

  // Other modals
  showUnsavedChangesModal: false,
  unsavedChangesTarget: null,
  showVideoUploadModal: false,
  videoUploadTab: 'upload',
  showAddToPlaylistModal: false,
  addToPlaylistTarget: null,

  // Shared
  modalInput: '',
};

export const modalsStore = writable<ModalState>(initialState);

// Shared utilities
export function setModalInput(input: string) {
  modalsStore.update(s => ({ ...s, modalInput: input }));
}
