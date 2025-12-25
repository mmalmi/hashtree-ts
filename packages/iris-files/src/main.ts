import 'virtual:uno.css';
import App from './App.svelte';
import { mount } from 'svelte';
import { initServiceWorker } from './lib/swInit';
import { setupTestHelpers } from './lib/testHelpers';
import { restoreSession } from './nostr';

async function init() {
  // Initialize service worker for PWA/caching
  await initServiceWorker();

  // Restore session and initialize worker before rendering
  // This ensures worker is ready when components need it
  await restoreSession();

  mount(App, {
    target: document.getElementById('app')!,
  });
}

init();
setupTestHelpers();
