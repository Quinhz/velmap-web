const CACHE_NAME = 'velmap-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/js/tailwind-config.js',
  '/js/i18n.js',
  '/js/db-state.js',
  '/js/ui-history.js',
  '/js/context-toolbar.js',
  '/js/connections.js',
  '/js/board-render.js',
  '/js/media-links.js',
  '/js/drag-drop.js',
  '/js/canvas-interactions.js',
  '/js/cards-actions.js',
  '/js/export.js',
  '/js/settings-profile.js',
  '/js/sync.js',
  '/favicon.ico'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        // Fetch in background to update cache
        fetch(event.request).then((res) => {
          if (res && res.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, res));
          }
        }).catch(() => {});
        return cached;
      }
      return fetch(event.request).then((res) => {
        if (!res || res.status !== 200 || res.type !== 'basic') return res;
        const responseToCache = res.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        return res;
      }).catch(() => caches.match('/index.html'));
    })
  );
});
