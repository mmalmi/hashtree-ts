/**
 * Git-related modals: gitignore, history, shell, commit, PR, issue
 */
import type { CID } from 'hashtree';
import { modalsStore, type GitignoreTarget } from './store';

// ========== Gitignore Modal ==========

export function openGitignoreModal(target: GitignoreTarget) {
  modalsStore.update(s => ({ ...s, showGitignoreModal: true, gitignoreTarget: target }));
}

export function closeGitignoreModal() {
  modalsStore.update(s => ({ ...s, showGitignoreModal: false, gitignoreTarget: null }));
}

// ========== Git History Modal ==========

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
