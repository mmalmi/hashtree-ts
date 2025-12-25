import 'virtual:uno.css';
import VideoApp from './VideoApp.svelte';
import { mount } from 'svelte';
import { initServiceWorker } from './lib/swInit';
import { setupTestHelpers } from './lib/testHelpers';
import { restoreSession } from './nostr';

async function init() {
  await initServiceWorker({ requireCrossOriginIsolation: true });

  // Restore session and initialize worker before rendering
  await restoreSession();

  mount(VideoApp, {
    target: document.getElementById('app')!,
  });
}

init();
setupTestHelpers();
