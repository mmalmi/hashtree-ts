import { createRoot } from 'react-dom/client';
import 'virtual:uno.css';
import 'open-props/style';
import { App } from './App';
import { initWebRTCTest } from './webrtc-test';
import * as hashtree from 'hashtree';

// Initialize WebRTC test for Playwright tests
initWebRTCTest();

// Expose hashtree for e2e tests
if (typeof window !== 'undefined') {
  (window as Window & { __hashtree?: typeof hashtree }).__hashtree = hashtree;
}

createRoot(document.getElementById('app')!).render(<App />);
