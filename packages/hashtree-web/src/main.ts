import 'virtual:uno.css';
import App from './App.svelte';
import { mount } from 'svelte';
import type { uploadSingleFile as UploadSingleFileType } from './actions/index';
import type * as HashTreeModule from 'hashtree';

// Extend window type for test helpers
declare global {
  interface Window {
    __testHelpers?: { uploadSingleFile: typeof UploadSingleFileType };
    __hashtree?: typeof HashTreeModule;
  }
}

const app = mount(App, {
  target: document.getElementById('app')!,
});

// Expose test helpers on window for e2e tests
if (typeof window !== 'undefined') {
  import('./actions/index').then(({ uploadSingleFile }) => {
    window.__testHelpers = { uploadSingleFile };
  });

  // Expose hashtree module for e2e tests (OpfsStore tests)
  import('hashtree').then((hashtree) => {
    window.__hashtree = hashtree;
  });
}

export default app;
