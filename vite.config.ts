import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';
import {buildTailwindCss} from './scripts/build-tailwind.mjs';

const rootDir = import.meta.dirname;

function copyStaticDirectoriesToDist(distDir: string) {
  const copyDirs = ['src/assets', 'css', 'js'];
  for (const dir of copyDirs) {
    const srcDir = path.resolve(rootDir, dir);
    const destDir = path.resolve(distDir, dir);
    if (fs.existsSync(distDir) && fs.existsSync(srcDir)) {
      fs.cpSync(srcDir, destDir, {recursive: true, force: true});
    }
  }
}

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      // Builds static Tailwind CSS and copies unbundled Velmap css/js assets into dist/
      // during writeBundle so Workbox precaches every offline script and stylesheet.
      {
        name: 'velmap-static-assets',
        apply: 'build',
        async buildStart() {
          await buildTailwindCss();
        },
        writeBundle() {
          const distDir = path.resolve(rootDir, 'dist');
          copyStaticDirectoriesToDist(distDir);
        },
      },
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: [
          'favicon.ico',
          'apple-touch-icon.png',
          'icon.svg',
          'pwa-192x192.png',
          'pwa-512x512.png',
          'pwa-maskable-512x512.png',
          '_headers',
        ],
        manifest: {
          id: '/',
          name: 'Velmap',
          short_name: 'Velmap',
          description:
            'Visual workspace for organizing ideas, boards, notes, tasks, links, and documents on an infinite canvas.',
          theme_color: '#18181b',
          background_color: '#141416',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2,webmanifest}'],
          globIgnores: ['**/node_modules/**/*', 'assets/aistudio/**', '_headers', 'css/tailwind-input.css'],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'gstatic-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'jsdelivr-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 90,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
        devOptions: {
          enabled: true,
          type: 'module',
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(rootDir, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
