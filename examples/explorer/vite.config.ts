import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import UnoCSS from 'unocss/vite';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    UnoCSS(),
    react(),
  ],
  root: resolve(__dirname),
  resolve: {
    alias: {
      'hashtree': resolve(__dirname, '../../src/index.ts'),
      'hashtree/webrtc': resolve(__dirname, '../../src/webrtc/index.ts'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: ['mayhem.iris.to'],
  },
});
