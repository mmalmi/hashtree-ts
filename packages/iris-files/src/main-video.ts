import 'virtual:uno.css';
import VideoApp from './VideoApp.svelte';
import { mount } from 'svelte';
import { initServiceWorker } from './lib/swInit';
import { setupTestHelpers } from './lib/testHelpers';
import { initUnifiedWorker } from './lib/workerInit';

async function init() {
  await initServiceWorker({ requireCrossOriginIsolation: true });

  // Start worker initialization (non-blocking)
  initUnifiedWorker();

  mount(VideoApp, {
    target: document.getElementById('app')!,
  });
}

init();
setupTestHelpers();
