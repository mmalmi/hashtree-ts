import 'virtual:uno.css';
import DocsApp from './DocsApp.svelte';
import { mount } from 'svelte';
import { initServiceWorker } from './lib/swInit';
import { setupTestHelpers } from './lib/testHelpers';

async function init() {
  await initServiceWorker();

  mount(DocsApp, {
    target: document.getElementById('app')!,
  });
}

init();
setupTestHelpers();
