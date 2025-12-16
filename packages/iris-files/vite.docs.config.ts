import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import UnoCSS from 'unocss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'path';
import { rename } from 'fs/promises';

function docsEntryPlugin(): Plugin {
  return {
    name: 'docs-entry',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url === '/') {
          req.url = '/docs.html';
        }
        next();
      });
    },
    async closeBundle() {
      // Rename docs.html to index.html for production (Cloudflare Pages)
      try {
        await rename(
          resolve(__dirname, 'dist-docs/docs.html'),
          resolve(__dirname, 'dist-docs/index.html')
        );
      } catch {
        // Ignore if file doesn't exist (dev mode)
      }
    },
  };
}

export default defineConfig({
  define: {
    'import.meta.env.VITE_BUILD_TIME': JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    docsEntryPlugin(),
    UnoCSS(),
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg'],
      manifest: {
        name: 'Iris Docs',
        short_name: 'Iris Docs',
        description: 'Collaborative documents on Nostr',
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
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.blossom\..*\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'blossom-cache',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
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
    outDir: 'dist-docs',
    emptyOutDir: true,
    reportCompressedSize: true,
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'docs.html'),
      },
      onLog(level, log, handler) {
        if (log.code === 'CIRCULAR_DEPENDENCY') return;
        handler(level, log);
      },
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.wasm')) {
            return 'assets/[name][extname]';
          }
          return 'assets/[name]-[hash][extname]';
        },
        manualChunks: (id) => {
          // Markdown rendering
          if (id.includes('marked')) {
            return 'markdown';
          }

          // Cashu wallet - only loaded on wallet page
          if (id.includes('coco-cashu') || id.includes('cashu-ts')) {
            return 'wallet';
          }

          // NDK
          if (id.includes('@nostr-dev-kit/ndk')) {
            return 'ndk';
          }

          // Dexie
          if (id.includes('dexie')) {
            return 'dexie';
          }

          // Tiptap/Yjs for collaborative editing
          if (id.includes('@tiptap') || id.includes('yjs') || id.includes('prosemirror')) {
            return 'editor';
          }

          // Core vendor libraries
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
      overlay: true,
    },
  },
  optimizeDeps: {
    exclude: ['wasm-git'],
  },
  assetsInclude: ['**/*.wasm'],
});
