import 'virtual:uno.css';
import VideoApp from './VideoApp.svelte';
import { mount } from 'svelte';
import { registerSW } from 'virtual:pwa-register';
import { setupSwFileHandler } from './lib/swFileHandler';

// Register service worker for file streaming
registerSW({
  immediate: true,
  onRegistered(r) {
    console.log('[SW] registered:', r);
  },
  onRegisterError(error) {
    console.error('[SW] registration error:', error);
  },
});

// Wait for SW to be ready before mounting app
// This ensures file streaming works on first visit
async function init() {
  if ('serviceWorker' in navigator) {
    // Wait for SW to be active and controlling this page
    if (!navigator.serviceWorker.controller) {
      console.log('[SW] Waiting for controller...');
      await new Promise<void>((resolve) => {
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          console.log('[SW] Controller now active');
          resolve();
        });
        // Also resolve if ready fires (fallback)
        navigator.serviceWorker.ready.then(() => {
          if (navigator.serviceWorker.controller) {
            resolve();
          }
        });
      });
    }
  }

  // Set up handler for SW file requests
  setupSwFileHandler();

  // Mount app
  mount(VideoApp, {
    target: document.getElementById('app')!,
  });
}

init();

// Expose test helpers on window for e2e tests
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
