import 'virtual:uno.css';
import App from './App.svelte';
import { mount } from 'svelte';
import type { uploadSingleFile as UploadSingleFileType } from './actions/index';
import type * as HashTreeModule from 'hashtree';
import type { followPubkey as FollowPubkeyType } from './stores/follows';
import type { webrtcStore as WebRTCStoreType, localStore as LocalStoreType } from './store';
import type { getSocialGraph as GetSocialGraphType } from './utils/socialGraph';
import type { settingsStore as SettingsStoreType, PoolSettings } from './stores/settings';
import { registerSW } from 'virtual:pwa-register';
import { setupSwFileHandler } from './lib/swFileHandler';

// Extend window type for test helpers
declare global {
  interface Window {
    __testHelpers?: {
      uploadSingleFile: typeof UploadSingleFileType;
      followPubkey: typeof FollowPubkeyType;
    };
    __hashtree?: typeof HashTreeModule;
    webrtcStore?: typeof WebRTCStoreType;
    __localStore?: typeof LocalStoreType;
    __getSocialGraph?: typeof GetSocialGraphType;
    __settingsStore?: typeof SettingsStoreType;
    __getWebRTCStore?: () => unknown;
    __setPoolSettings?: (pools: Partial<PoolSettings>) => void;
    __getMyPubkey?: () => string | null;
    __getTreeRoot?: () => string | null;
    __disableFallbackStores?: () => void;
  }
}

// Register service worker for PWA and file streaming
const updateSW = registerSW({
  immediate: true,
  onRegisteredSW(swUrl) {
    console.log('[SW] Registered:', swUrl);
  },
  onRegisterError(error) {
    console.error('[SW] Registration error:', error);
  },
});

// Setup file request handler - listens for SW file requests
// No need to wait for SW activation - just needs to be listening
setupSwFileHandler();

const app = mount(App, {
  target: document.getElementById('app')!,
});

// Expose test helpers on window for e2e tests
if (typeof window !== 'undefined') {
  import('./actions/index').then(({ uploadSingleFile }) => {
    import('./stores/follows').then(({ followPubkey }) => {
      window.__testHelpers = { uploadSingleFile, followPubkey };
    });
  });

  // Expose hashtree module for e2e tests (OpfsStore tests)
  import('hashtree').then((hashtree) => {
    window.__hashtree = hashtree;
  });

  // Expose webrtcStore for e2e tests
  import('./store').then(({ webrtcStore, localStore, getWebRTCStore }) => {
    // Use getter to always get current value
    Object.defineProperty(window, 'webrtcStore', {
      get: () => webrtcStore,
      configurable: true,
    });
    window.__localStore = localStore;
    window.__getWebRTCStore = getWebRTCStore;
  });

  // Expose social graph for e2e tests
  import('./utils/socialGraph').then(({ getSocialGraph }) => {
    window.__getSocialGraph = getSocialGraph;
  });

  // Expose settings store for e2e tests
  import('./stores/settings').then(({ settingsStore }) => {
    window.__settingsStore = settingsStore;
    window.__setPoolSettings = (pools) => settingsStore.setPoolSettings(pools);
  });

  // Expose pubkey getter for e2e tests
  import('./nostr').then(({ useNostrStore }) => {
    window.__getMyPubkey = () => useNostrStore.getState().pubkey;
  });

  // Expose tree root getter for e2e tests
  import('./stores').then(({ treeRootStore }) => {
    import('svelte/store').then(({ get }) => {
      import('hashtree').then(({ toHex }) => {
        window.__getTreeRoot = () => {
          const rootCid = get(treeRootStore);
          return rootCid?.hash ? toHex(rootCid.hash) : null;
        };
      });
    });
  });
}

export default app;
