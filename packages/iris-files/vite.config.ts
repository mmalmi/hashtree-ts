import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import UnoCSS from 'unocss/vite';
import { visualizer } from 'rollup-plugin-visualizer';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'path';

// Worker entry point
const workerEntry = resolve(__dirname, '../hashtree/src/worker/worker.ts');

export default defineConfig({
  define: {
    'import.meta.env.VITE_BUILD_TIME': JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    UnoCSS(),
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      includeAssets: ['iris-favicon.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Iris Files',
        short_name: 'Iris Files',
        description: 'Content-addressed file storage on Nostr',
        theme_color: '#0d1117',
        background_color: '#0d1117',
        display: 'standalone',
        icons: [
          {
            src: 'iris-logo.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'iris-logo.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'iris-logo.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,wasm}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5MB for wasm files
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
      'wasm-git': resolve(__dirname, 'node_modules/wasm-git/lg2_async.js'),
    },
  },
  build: {
    reportCompressedSize: true,
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      // Externalize Tauri plugins for web builds - they're dynamically imported with isTauri() checks
      external: [
        '@tauri-apps/plugin-autostart',
        '@tauri-apps/plugin-dialog',
        '@tauri-apps/plugin-notification',
        '@tauri-apps/plugin-opener',
        '@tauri-apps/plugin-os',
        '@tauri-apps/api',
      ],
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
    allowedHosts: ['mayhem2.iris.to', 'mayhem1.iris.to', 'mayhem3.iris.to', 'mayhem4.iris.to'],
    hmr: {
      // Ensure HMR websocket connection is stable
      overlay: true,
    },
  },
  optimizeDeps: {
    exclude: ['wasm-git'], // Don't pre-bundle wasm-git, let it load its own wasm
  },
  assetsInclude: ['**/*.wasm'], // Treat wasm files as assets
  worker: {
    format: 'es',
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
      },
    },
  },
});
