import 'virtual:uno.css';
import DocsApp from './DocsApp.svelte';
import { mount } from 'svelte';
import { initServiceWorker } from './lib/swInit';
import { setupTestHelpers } from './lib/testHelpers';
import { restoreSession } from './nostr';

async function init() {
  await initServiceWorker();

  // Restore session and initialize worker before rendering
  await restoreSession();

  mount(DocsApp, {
    target: document.getElementById('app')!,
  });
}

init();
setupTestHelpers();
