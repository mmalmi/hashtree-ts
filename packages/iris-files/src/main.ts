import 'virtual:uno.css';
import App from './App.svelte';
import { mount } from 'svelte';
import { initServiceWorker } from './lib/swInit';
import { initHashtreeWorker } from './lib/workerInit';
import { setupTestHelpers } from './lib/testHelpers';

async function init() {
  // Initialize service worker for PWA/caching
  await initServiceWorker();

  // Initialize hashtree worker for storage/networking (non-blocking)
  // Worker runs in parallel, app works without it during init
  initHashtreeWorker().catch(console.error);

  mount(App, {
    target: document.getElementById('app')!,
  });
}

init();
setupTestHelpers();
