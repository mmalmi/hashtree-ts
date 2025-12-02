import { createRoot } from 'react-dom/client';
import 'virtual:uno.css';
import 'open-props/style';
import { App } from './App';
import { initWebRTCTest } from './webrtc-test';

// Initialize WebRTC test for Playwright tests
initWebRTCTest();

createRoot(document.getElementById('app')!).render(<App />);
