import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  // wersja aplikacji z package.json — pokazywana w ustawieniach
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon.svg'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // obsługa web push (przypomnienia o 19:00) — plik z public/, doklejany do SW
        importScripts: ['push-sw.js'],
        runtimeCaching: [
          {
            // dane kursu — cache-first, offline-first
            urlPattern: /\/data\/.*\.json$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'kurs-data',
              expiration: { maxEntries: 200 },
            },
          },
        ],
      },
      manifest: {
        name: 'Kurs hiszpańskiego',
        short_name: 'Hiszpański',
        description: 'Kurs języka hiszpańskiego — 100 lekcji, offline-first',
        lang: 'pl',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        start_url: '/',
        icons: [
          { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
});
