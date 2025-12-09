import 'virtual:uno.css';
import App from './App.svelte';
import { mount } from 'svelte';

const app = mount(App, {
  target: document.getElementById('app')!,
});

// Expose test helpers on window for e2e tests
if (typeof window !== 'undefined') {
  import('./actions/index').then(({ uploadSingleFile }) => {
    (window as any).__testHelpers = {
      uploadSingleFile
    };
  });

  // Expose hashtree module for e2e tests (OpfsStore tests)
  import('hashtree').then((hashtree) => {
    (window as any).__hashtree = hashtree;
  });
}

export default app;
