/**
 * Other modals: unsaved changes, add to playlist
 */
import { derived } from 'svelte/store';
import { modalsStore, type UnsavedChangesTarget, type AddToPlaylistTarget } from './store';
import type { CID } from 'hashtree';

// ========== Unsaved Changes Modal ==========

export const showUnsavedChangesModal = derived(modalsStore, s => s.showUnsavedChangesModal);
export const unsavedChangesTarget = derived(modalsStore, s => s.unsavedChangesTarget);

export function openUnsavedChangesModal(target: UnsavedChangesTarget) {
  modalsStore.update(s => ({
    ...s,
    showUnsavedChangesModal: true,
    unsavedChangesTarget: target,
  }));
}

export function closeUnsavedChangesModal() {
  modalsStore.update(s => ({
    ...s,
    showUnsavedChangesModal: false,
    unsavedChangesTarget: null,
  }));
}

// ========== Add To Playlist Modal ==========

export const showAddToPlaylistModal = derived(modalsStore, s => s.showAddToPlaylistModal);
export const addToPlaylistTarget = derived(modalsStore, s => s.addToPlaylistTarget);

export function openAddToPlaylistModal(videoCid: CID, videoTitle: string, videoSize: number) {
  modalsStore.update(s => ({
    ...s,
    showAddToPlaylistModal: true,
    addToPlaylistTarget: { videoCid, videoTitle, videoSize },
    modalInput: '',
  }));
}

export function closeAddToPlaylistModal() {
  modalsStore.update(s => ({
    ...s,
    showAddToPlaylistModal: false,
    addToPlaylistTarget: null,
    modalInput: '',
  }));
}
