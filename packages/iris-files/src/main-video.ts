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
    // Log SW controller status for debugging iOS Safari
    if (navigator.serviceWorker.controller) {
      console.log('[SW] Controller active:', navigator.serviceWorker.controller.state);
    } else {
      console.warn('[SW] No controller yet - waiting for controllerchange');
    }
  },
  onRegisterError(error) {
    console.error('[SW] registration error:', error);
  },
});

// On first visit, SW won't control the page until reload.
// Wait for controller to become available and reload once.
if (navigator.serviceWorker && !navigator.serviceWorker.controller) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    console.log('[SW] Controller now available, reloading for SW to take control');
    window.location.reload();
  });
}

// Set up handler for SW file requests
setupSwFileHandler();

const app = mount(VideoApp, {
  target: document.getElementById('app')!,
});

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
