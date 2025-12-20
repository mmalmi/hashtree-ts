/**
 * Git-related modals: gitignore, history, shell, commit, PR, issue
 */
import { derived } from 'svelte/store';
import type { CID } from 'hashtree';
import { modalsStore, type GitignoreTarget } from './store';

// ========== Gitignore Modal ==========

export const showGitignoreModal = derived(modalsStore, s => s.showGitignoreModal);
export const gitignoreTarget = derived(modalsStore, s => s.gitignoreTarget);

export function openGitignoreModal(target: GitignoreTarget) {
  modalsStore.update(s => ({ ...s, showGitignoreModal: true, gitignoreTarget: target }));
}

export function closeGitignoreModal() {
  modalsStore.update(s => ({ ...s, showGitignoreModal: false, gitignoreTarget: null }));
}

// ========== Git History Modal ==========

export const showGitHistoryModal = derived(modalsStore, s => s.showGitHistoryModal);
export const gitHistoryTarget = derived(modalsStore, s => s.gitHistoryTarget);

export function openGitHistoryModal(
  dirCid: CID,
  canEdit: boolean = false,
  onCheckout?: (commitSha: string) => Promise<void>
) {
  modalsStore.update(s => ({
    ...s,
    showGitHistoryModal: true,
    gitHistoryTarget: { dirCid, canEdit, onCheckout },
  }));
}

export function closeGitHistoryModal() {
  modalsStore.update(s => ({ ...s, showGitHistoryModal: false, gitHistoryTarget: null }));
}

// ========== Git Shell Modal ==========

export const showGitShellModal = derived(modalsStore, s => s.showGitShellModal);
export const gitShellTarget = derived(modalsStore, s => s.gitShellTarget);

export function openGitShellModal(
  dirCid: CID,
  canEdit?: boolean,
  onChange?: (newDirCid: CID) => void
) {
  modalsStore.update(s => ({
    ...s,
    showGitShellModal: true,
    gitShellTarget: { dirCid, canEdit, onChange },
  }));
}

export function closeGitShellModal() {
  modalsStore.update(s => ({ ...s, showGitShellModal: false, gitShellTarget: null }));
}

// ========== Git Commit Modal ==========

export const showGitCommitModal = derived(modalsStore, s => s.showGitCommitModal);
export const gitCommitTarget = derived(modalsStore, s => s.gitCommitTarget);

export function openGitCommitModal(
  dirCid: CID,
  onCommit?: (newDirCid: CID) => Promise<void>
) {
  modalsStore.update(s => ({
    ...s,
    showGitCommitModal: true,
    gitCommitTarget: { dirCid, onCommit },
    modalInput: '',
  }));
}

export function closeGitCommitModal() {
  modalsStore.update(s => ({
    ...s,
    showGitCommitModal: false,
    gitCommitTarget: null,
    modalInput: '',
  }));
}

// ========== New Pull Request Modal ==========

export const showNewPullRequestModal = derived(modalsStore, s => s.showNewPullRequestModal);
export const newPullRequestTarget = derived(modalsStore, s => s.newPullRequestTarget);

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
  modalsStore.update(s => ({
    ...s,
    showNewPullRequestModal: false,
    newPullRequestTarget: null,
    modalInput: '',
  }));
}

// ========== New Issue Modal ==========

export const showNewIssueModal = derived(modalsStore, s => s.showNewIssueModal);
export const newIssueTarget = derived(modalsStore, s => s.newIssueTarget);

export function openNewIssueModal(
  npub: string,
  repoName: string,
  onCreate?: (issue: { id: string; title: string }) => void
) {
  modalsStore.update(s => ({
    ...s,
    showNewIssueModal: true,
    newIssueTarget: { npub, repoName, onCreate },
    modalInput: '',
  }));
}

export function closeNewIssueModal() {
  modalsStore.update(s => ({
    ...s,
    showNewIssueModal: false,
    newIssueTarget: null,
    modalInput: '',
  }));
}
