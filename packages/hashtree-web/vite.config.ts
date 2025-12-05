import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import UnoCSS from 'unocss/vite';
import { visualizer } from 'rollup-plugin-visualizer';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    UnoCSS(),
    react(),
    visualizer({
      open: false,
      gzipSize: true,
      filename: 'dist/stats.html',
    }),
    visualizer({
      open: false,
      gzipSize: true,
      filename: 'dist/stats-list.txt',
      template: 'list',
    }),
  ],
  root: resolve(__dirname),
  resolve: {
    alias: {
      'hashtree': resolve(__dirname, '../hashtree/src/index.ts'),
      'hashtree/webrtc': resolve(__dirname, '../hashtree/src/webrtc/index.ts'),
    },
  },
  build: {
    reportCompressedSize: true,
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      onLog(level, log, handler) {
        if (log.code === 'CIRCULAR_DEPENDENCY') return;
        handler(level, log);
      },
      output: {
        assetFileNames: (assetInfo) => {
          // Keep WASM files in assets root with original name
          if (assetInfo.name?.endsWith('.wasm')) {
            return 'assets/[name][extname]';
          }
          return 'assets/[name]-[hash][extname]';
        },
        manualChunks: (id) => {
          // DOSBox emulator - lazy loaded only when viewing .exe files
          if (id.includes('emulators') || id.includes('js-dos')) {
            return 'dosbox';
          }

          // Markdown rendering - statically split for caching
          if (id.includes('markdown-to-jsx')) {
            return 'markdown';
          }

          // ZIP handling - lazy loaded for archive operations
          if (id.includes('fflate')) {
            return 'compression';
          }

          // Video/media handling
          if (id.includes('hls.js')) {
            return 'media';
          }

          // Cashu wallet - only loaded on wallet page
          if (id.includes('coco-cashu') || id.includes('cashu-ts')) {
            return 'wallet';
          }

          // NDK - large, keep separate from vendor for caching
          if (id.includes('@nostr-dev-kit/ndk')) {
            return 'ndk';
          }

          // Dexie (IndexedDB) - large, separate chunk
          if (id.includes('dexie')) {
            return 'dexie';
          }

          // Core vendor libraries - React, crypto, state management
          const vendorLibs = [
            'react',
            'react-dom',
            'react-router-dom',
            'nostr-tools',
            '@noble/hashes',
            '@noble/curves',
            '@scure/base',
            'zustand',
            'idb-keyval',
          ];
          if (vendorLibs.some((lib) => id.includes(`node_modules/${lib}`))) {
            return 'vendor';
          }
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: ['mayhem.iris.to'],
  },
});
