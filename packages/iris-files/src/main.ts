import 'virtual:uno.css';
import App from './App.svelte';
import { mount } from 'svelte';
import { initServiceWorker } from './lib/swInit';
import { setupTestHelpers } from './lib/testHelpers';
import { initUnifiedWorker } from './lib/workerInit';

async function init() {
  await initServiceWorker();

  // Start worker initialization (non-blocking)
  initUnifiedWorker();

  mount(App, {
    target: document.getElementById('app')!,
  });
}

init();
setupTestHelpers();
