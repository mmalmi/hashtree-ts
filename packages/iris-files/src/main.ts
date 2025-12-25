import 'virtual:uno.css';
import App from './App.svelte';
import { mount } from 'svelte';
import { initServiceWorker } from './lib/swInit';
import { setupTestHelpers } from './lib/testHelpers';

async function init() {
  // Initialize service worker for PWA/caching
  await initServiceWorker();

  // Worker is initialized in nostr.ts after login (needs user's key)

  mount(App, {
    target: document.getElementById('app')!,
  });
}

init();
setupTestHelpers();
