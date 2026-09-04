/* K1266 Service Worker — PWA offline cache */
/* Additive only: does not touch app logic. Caches same-origin static assets. */
/* External APIs (Google Sheets, Workers, raw GitHub) are network-only. */

const CACHE_NAME = 'k1266-v4';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/members.js',
  './js/guides.js',
  './js/redeem.js',
  './js/status.js',
  './js/pwa-install.js',
  './data/guides.json',
  './manifest.webmanifest',
  './icons/icon-96.png',
  './icons/icon-144.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
      .catch((err) => {
        // install should not fail completely if one asset missing
        console.warn('[SW] install cache failed', err);
      })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GET
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Bypass cross-origin entirely (Sheets, Workers, GitHub raw, Fonts)
  // Only cache same-origin assets
  if (url.origin !== location.origin) return;

  // For navigation requests: network-first, fallback to cached index.html
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const networkResp = await fetch(req);
        // update cache with fresh index.html (best-effort)
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, networkResp.clone());
        return networkResp;
      } catch (e) {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(req);
        if (cached) return cached;
        const fallback = await cache.match('./index.html') || await cache.match('./');
        if (fallback) return fallback;
        // last resort: try any cached index
        return Response.error();
      }
    })());
    return;
  }

  // For same-origin static assets: cache-first, then network
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);
    if (cached) return cached;

    try {
      const networkResp = await fetch(req);
      // Only cache successful, basic/cors-opaque? but same-origin so basic
      if (networkResp && networkResp.status === 200 && networkResp.type === 'basic') {
        cache.put(req, networkResp.clone());
      }
      return networkResp;
    } catch (e) {
      // if both cache and network fail, return error
      // For images/css/js fallback could return empty but we let it fail
      return Response.error();
    }
  })());
});

// Allow page to trigger skipWaiting via postMessage
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
