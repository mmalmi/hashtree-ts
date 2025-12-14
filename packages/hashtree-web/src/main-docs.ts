import 'virtual:uno.css';
import DocsApp from './DocsApp.svelte';
import { mount } from 'svelte';

const app = mount(DocsApp, {
  target: document.getElementById('app')!,
});

export default app;
