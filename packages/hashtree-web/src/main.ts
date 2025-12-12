import 'virtual:uno.css';
import App from './App.svelte';
import { mount } from 'svelte';
import type { uploadSingleFile as UploadSingleFileType } from './actions/index';
import type * as HashTreeModule from 'hashtree';
import type { followPubkey as FollowPubkeyType } from './stores/follows';
import type { webrtcStore as WebRTCStoreType, idbStore as IdbStoreType } from './store';
import type { getSocialGraph as GetSocialGraphType } from './utils/socialGraph';
import type { settingsStore as SettingsStoreType } from './stores/settings';

// Extend window type for test helpers
declare global {
  interface Window {
    __testHelpers?: {
      uploadSingleFile: typeof UploadSingleFileType;
      followPubkey: typeof FollowPubkeyType;
    };
    __hashtree?: typeof HashTreeModule;
    webrtcStore?: typeof WebRTCStoreType;
    __idbStore?: typeof IdbStoreType;
    __getSocialGraph?: typeof GetSocialGraphType;
    __settingsStore?: typeof SettingsStoreType;
  }
}

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
  import('./store').then(({ webrtcStore, idbStore }) => {
    // Use getter to always get current value
    Object.defineProperty(window, 'webrtcStore', {
      get: () => webrtcStore,
      configurable: true,
    });
    window.__idbStore = idbStore;
  });

  // Expose social graph for e2e tests
  import('./utils/socialGraph').then(({ getSocialGraph }) => {
    window.__getSocialGraph = getSocialGraph;
  });

  // Expose settings store for e2e tests
  import('./stores/settings').then(({ settingsStore }) => {
    window.__settingsStore = settingsStore;
  });
}

export default app;
