const CACHE_NAME = 'erp-v4';
const STATIC_CACHE = 'erp-static-v4';
const DATA_CACHE = 'erp-data-v3';
const IS_LOCAL_DEVELOPMENT = ['localhost', '127.0.0.1', '::1'].includes(self.location.hostname);

// App shell files to precache on install
const SHELL_FILES = [
  '/',
  '/index.html',
  '/offline.html',
];

// Install: cache the app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== STATIC_CACHE && key !== CACHE_NAME && key !== DATA_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch handler with different strategies per request type
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Never cache Vite development modules or its HMR client. Caching them
  // serves stale source files and breaks the development WebSocket.
  if (IS_LOCAL_DEVELOPMENT) return;

  // Only handle GET requests
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Skip Supabase API requests (they need auth tokens, can't be cached)
  if (url.hostname.includes('supabase')) return;

  // Skip chrome extension requests
  if (url.protocol === 'chrome-extension:') return;

  // 1. Navigation requests: network-first, fallback to cache, then offline page
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          void caches.open(STATIC_CACHE)
            .then((cache) => cache.put(request, clone))
            .catch(() => undefined);
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) =>
            cached || caches.match('/offline.html') || new Response('Offline', { status: 503 })
          )
        )
    );
    return;
  }

  // 2. Static assets (JS, CSS, fonts, images): cache-first
  if (
    request.destination === 'script' ||
    request.destination === 'style' ||
    request.destination === 'font' ||
    request.destination === 'image' ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.ico') ||
    url.pathname.endsWith('.woff2')
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request)
          .then((response) => {
            if (response.ok) {
              const clone = response.clone();
              void caches.open(STATIC_CACHE)
                .then((cache) => cache.put(request, clone))
                .catch(() => undefined);
            }
            return response;
          })
          .catch(() => new Response('Asset unavailable offline', { status: 503 }));
      })
    );
    return;
  }

  // 3. Everything else: network with cache fallback
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          void caches.open(CACHE_NAME)
            .then((cache) => cache.put(request, clone))
            .catch(() => undefined);
        }
        return response;
      })
      .catch(() => caches.match(request).then(
        (cached) => cached || new Response('Request unavailable offline', { status: 503 })
      ))
  );
});

// Listen for messages from the app
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
