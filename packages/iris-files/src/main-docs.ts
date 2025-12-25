import 'virtual:uno.css';
import DocsApp from './DocsApp.svelte';
import { mount } from 'svelte';
import { initServiceWorker } from './lib/swInit';
import { setupTestHelpers } from './lib/testHelpers';
import { initUnifiedWorker } from './lib/workerInit';

async function init() {
  await initServiceWorker();

  // Start worker initialization (non-blocking)
  initUnifiedWorker();

  mount(DocsApp, {
    target: document.getElementById('app')!,
  });
}

init();
setupTestHelpers();
