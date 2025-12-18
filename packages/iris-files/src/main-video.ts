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

      // Wait for SW to be ready (active)
      await navigator.serviceWorker.ready;

      // If still no controller after SW is ready, wait for controllerchange or reload
      if (!navigator.serviceWorker.controller) {
        const gotController = await Promise.race([
          new Promise<boolean>((resolve) => {
            navigator.serviceWorker.addEventListener('controllerchange', () => {
              console.log('[SW] Controller now active');
              resolve(true);
            }, { once: true });
          }),
          // Small timeout just in case controllerchange already fired
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 100)),
        ]);

        // If no controller after SW is ready, reload to let SW take control
        if (!gotController && !navigator.serviceWorker.controller) {
          console.log('[SW] No controller after SW ready, reloading...');
          window.location.reload();
          return;
        }
      }
    }

    // Check if cross-origin isolated (needed for SharedArrayBuffer/FFmpeg)
    // SW adds COOP/COEP headers, but we need to reload for them to take effect
    // Only reload once to avoid infinite loop if SW headers don't work
    const coiReloadKey = 'coi-reload-attempted';
    if (navigator.serviceWorker.controller && !self.crossOriginIsolated) {
      if (!sessionStorage.getItem(coiReloadKey)) {
        sessionStorage.setItem(coiReloadKey, '1');
        console.log('[SW] Not cross-origin isolated, reloading for COOP/COEP headers...');
        window.location.reload();
        return;
      } else {
        console.log('[SW] Cross-origin isolation not available after reload - FFmpeg transcoding disabled');
      }
    } else if (self.crossOriginIsolated) {
      // Clear the flag if we successfully got isolation
      sessionStorage.removeItem(coiReloadKey);
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
