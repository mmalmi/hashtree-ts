/**
 * Service Worker initialization utilities
 * Shared between all app entry points (main, docs, video)
 */

import { registerSW } from 'virtual:pwa-register';
import { setupSwFileHandler } from './swFileHandler';

interface InitOptions {
  /** Require cross-origin isolation (for SharedArrayBuffer/FFmpeg) */
  requireCrossOriginIsolation?: boolean;
}

/**
 * Initialize service worker and wait for it to be ready
 * Returns a promise that resolves when SW is controlling the page
 */
export async function initServiceWorker(options: InitOptions = {}): Promise<void> {
  // Register service worker
  registerSW({
    immediate: true,
    onRegisteredSW(swUrl) {
      console.log('[SW] Registered:', swUrl);
    },
    onRegisterError(error) {
      console.error('[SW] Registration error:', error);
    },
  });

  // Setup file request handler - listens for SW file requests
  setupSwFileHandler();

  if (!('serviceWorker' in navigator)) {
    return;
  }

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
        // Return a never-resolving promise since we're reloading
        return new Promise(() => {});
      }
    }
  }

  // Check if cross-origin isolation is required (for SharedArrayBuffer/FFmpeg)
  if (options.requireCrossOriginIsolation) {
    const coiReloadKey = 'coi-reload-attempted';
    if (navigator.serviceWorker.controller && !self.crossOriginIsolated) {
      if (!sessionStorage.getItem(coiReloadKey)) {
        sessionStorage.setItem(coiReloadKey, '1');
        console.log('[SW] Not cross-origin isolated, reloading for COOP/COEP headers...');
        window.location.reload();
        return new Promise(() => {});
      } else {
        console.log('[SW] Cross-origin isolation not available after reload - FFmpeg transcoding disabled');
      }
    } else if (self.crossOriginIsolated) {
      sessionStorage.removeItem(coiReloadKey);
    }
  }
}
