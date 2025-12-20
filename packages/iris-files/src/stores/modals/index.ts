/**
 * Modal state management - re-exports all modal functions and types
 */

// Core store and types
export { modalsStore, setModalInput } from './store';
export type {
  ModalState,
  ModalType,
  ExtractLocation,
  VideoUploadTab,
  ArchiveFileInfo,
  ForkTarget,
  ExtractTarget,
  GitignoreTarget,
  GitHistoryTarget,
  GitShellTarget,
  CollaboratorsTarget,
  UnsavedChangesTarget,
  NewPullRequestTarget,
  NewIssueTarget,
  GitCommitTarget,
  BlossomPushTarget,
  AddToPlaylistTarget,
} from './store';

// File modals
export {
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
} from './file';

// Git modals
export {
  openGitignoreModal,
  closeGitignoreModal,
  openGitHistoryModal,
  closeGitHistoryModal,
  openGitShellModal,
  closeGitShellModal,
  openGitCommitModal,
  closeGitCommitModal,
  openNewPullRequestModal,
  closeNewPullRequestModal,
  openNewIssueModal,
  closeNewIssueModal,
} from './git';

// Share modals
export {
  openShareModal,
  closeShareModal,
  openCollaboratorsModal,
  updateCollaboratorsModal,
  closeCollaboratorsModal,
  openBlossomPushModal,
  closeBlossomPushModal,
} from './share';

// Other modals
export {
  openUnsavedChangesModal,
  closeUnsavedChangesModal,
  openVideoUploadModal,
  closeVideoUploadModal,
  setVideoUploadTab,
  openAddToPlaylistModal,
  closeAddToPlaylistModal,
} from './other';
