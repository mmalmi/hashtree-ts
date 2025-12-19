import 'virtual:uno.css';
import VideoApp from './VideoApp.svelte';
import { mount } from 'svelte';
import { initServiceWorker } from './lib/swInit';
import { setupTestHelpers } from './lib/testHelpers';

async function init() {
  await initServiceWorker({ requireCrossOriginIsolation: true });

  mount(VideoApp, {
    target: document.getElementById('app')!,
  });
}

init();
setupTestHelpers();
