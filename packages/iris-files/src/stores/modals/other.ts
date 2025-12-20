/**
 * Other modals: unsaved changes, video upload, add to playlist
 */
import { modalsStore, type UnsavedChangesTarget, type VideoUploadTab, type AddToPlaylistTarget } from './store';
import type { CID } from 'hashtree';

// ========== Unsaved Changes Modal ==========

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

// ========== Video Upload Modal ==========

export function openVideoUploadModal(tab: VideoUploadTab = 'upload') {
  modalsStore.update(s => ({
    ...s,
    showVideoUploadModal: true,
    videoUploadTab: tab,
  }));
}

export function closeVideoUploadModal() {
  modalsStore.update(s => ({
    ...s,
    showVideoUploadModal: false,
    videoUploadTab: 'upload',
  }));
}

export function setVideoUploadTab(tab: VideoUploadTab) {
  modalsStore.update(s => ({ ...s, videoUploadTab: tab }));
}

// ========== Add To Playlist Modal ==========

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
