/**
 * Sharing-related modals: share, collaborators, blossom push
 */
import { derived } from 'svelte/store';
import type { CID } from 'hashtree';
import { modalsStore } from './store';

// ========== Share Modal ==========

export const showShareModal = derived(modalsStore, s => s.showShareModal);
export const shareUrl = derived(modalsStore, s => s.shareUrl);

export function openShareModal(url: string) {
  modalsStore.update(s => ({ ...s, showShareModal: true, shareUrl: url }));
}

export function closeShareModal() {
  modalsStore.update(s => ({ ...s, showShareModal: false, shareUrl: null }));
}

// ========== Collaborators Modal ==========

export const showCollaboratorsModal = derived(modalsStore, s => s.showCollaboratorsModal);
export const collaboratorsTarget = derived(modalsStore, s => s.collaboratorsTarget);

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

export const showBlossomPushModal = derived(modalsStore, s => s.showBlossomPushModal);
export const blossomPushTarget = derived(modalsStore, s => s.blossomPushTarget);

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
