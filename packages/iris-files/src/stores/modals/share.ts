/**
 * Sharing-related modals: share, collaborators, blossom push
 */
import type { CID } from 'hashtree';
import { modalsStore } from './store';

// ========== Share Modal ==========

export function openShareModal(url: string) {
  modalsStore.update(s => ({ ...s, showShareModal: true, shareUrl: url }));
}

export function closeShareModal() {
  modalsStore.update(s => ({ ...s, showShareModal: false, shareUrl: null }));
}

// ========== Collaborators Modal ==========

export function openCollaboratorsModal(npubs: string[], onSave?: (npubs: string[]) => void) {
  modalsStore.update(s => ({
    ...s,
    showCollaboratorsModal: true,
    collaboratorsTarget: { npubs, onSave },
  }));
}

export function updateCollaboratorsModal(npubs: string[]) {
  modalsStore.update(s => {
    if (!s.showCollaboratorsModal || !s.collaboratorsTarget) return s;
    return { ...s, collaboratorsTarget: { ...s.collaboratorsTarget, npubs } };
  });
}

export function closeCollaboratorsModal() {
  modalsStore.update(s => ({
    ...s,
    showCollaboratorsModal: false,
    collaboratorsTarget: null,
  }));
}

// ========== Blossom Push Modal ==========

export function openBlossomPushModal(cid: CID, name: string, isDirectory: boolean) {
  modalsStore.update(s => ({
    ...s,
    showBlossomPushModal: true,
    blossomPushTarget: { cid, name, isDirectory },
  }));
}

export function closeBlossomPushModal() {
  modalsStore.update(s => ({
    ...s,
    showBlossomPushModal: false,
    blossomPushTarget: null,
  }));
}
