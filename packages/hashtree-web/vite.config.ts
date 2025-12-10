import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import UnoCSS from 'unocss/vite';
import { visualizer } from 'rollup-plugin-visualizer';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    UnoCSS(),
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg'],
      manifest: {
        name: 'hashtree',
        short_name: 'hashtree',
        description: 'Content-addressed file storage on Nostr',
        theme_color: '#1a1a2e',
        background_color: '#1a1a2e',
        display: 'standalone',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,wasm}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5MB for wasm files
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.blossom\..*\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'blossom-cache',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
    }),
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
      '$lib': resolve(__dirname, 'src/lib'),
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
          if (id.includes('marked')) {
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

          // Core vendor libraries - Svelte, crypto, state management
          const vendorLibs = [
            'svelte',
            'nostr-tools',
            '@noble/hashes',
            '@noble/curves',
            '@scure/base',
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
    allowedHosts: ['mayhem.iris.to', 'mayhem1.iris.to'],
    hmr: {
      // Ensure HMR websocket connection is stable
      overlay: true,
    },
  },
});
