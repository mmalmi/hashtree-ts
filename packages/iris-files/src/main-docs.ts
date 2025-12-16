import 'virtual:uno.css';
import DocsApp from './DocsApp.svelte';
import { mount } from 'svelte';

const app = mount(DocsApp, {
  target: document.getElementById('app')!,
});

// Expose test helpers on window for e2e tests (same as main.ts)
if (typeof window !== 'undefined') {
  import('./actions/index').then(({ uploadSingleFile }) => {
    import('./stores/follows').then(({ followPubkey }) => {
      window.__testHelpers = { uploadSingleFile, followPubkey };
    });
  });

  // Expose webrtcStore for e2e tests
  import('./store').then(({ webrtcStore, localStore }) => {
    Object.defineProperty(window, 'webrtcStore', {
      get: () => webrtcStore,
      configurable: true,
    });
    window.__localStore = localStore;
  });

  // Expose social graph for e2e tests
  import('./utils/socialGraph').then(({ getSocialGraph }) => {
    window.__getSocialGraph = getSocialGraph;
    // Also expose as getter for compatibility
    Object.defineProperty(window, '__socialGraph', {
      get: () => getSocialGraph(),
      configurable: true,
    });
  });

  // Expose settings store for e2e tests
  import('./stores/settings').then(({ settingsStore }) => {
    window.__settingsStore = settingsStore;
  });
}

export default app;
