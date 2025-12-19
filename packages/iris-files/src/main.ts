import 'virtual:uno.css';
import App from './App.svelte';
import { mount } from 'svelte';
import { initServiceWorker } from './lib/swInit';
import { setupTestHelpers } from './lib/testHelpers';

async function init() {
  await initServiceWorker();

  mount(App, {
    target: document.getElementById('app')!,
  });
}

init();
setupTestHelpers();
