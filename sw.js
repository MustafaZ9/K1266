/* K1266 Service Worker — PWA offline cache */
/* Additive only: does not touch app logic. Caches same-origin static assets. */
/* External APIs (Google Sheets, Workers, raw GitHub) are network-only. */

const CACHE_NAME = 'k1266-v6';
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
  './js/push.js',
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
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Cache assets one by one: a single missing file must not block the whole
    // update (that used to leave phones stuck on an old redeem.js forever).
    await Promise.all(ASSETS.map(async (asset) => {
      try {
        await cache.add(asset);
      } catch (err) {
        console.warn('[SW] could not cache', asset, err);
      }
    }));
    await self.skipWaiting();
  })());
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
        const networkResp = await fetch(req, { cache: 'no-store' });
        // update cache with fresh index.html (best-effort)
        if (networkResp && networkResp.status === 200) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(req, networkResp.clone());
        }
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

  // Code assets (JS/CSS/HTML/manifest/data): network-first, so a new deploy is
  // picked up on the next load instead of being served stale from the cache.
  const isCodeAsset = /\.(?:js|css|html|webmanifest|json)$/.test(url.pathname);
  if (isCodeAsset) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const networkResp = await fetch(req, { cache: 'no-store' });
        if (networkResp && networkResp.status === 200 && networkResp.type === 'basic') {
          cache.put(req, networkResp.clone());
        }
        return networkResp;
      } catch (e) {
        const cached = await cache.match(req);
        return cached || Response.error();
      }
    })());
    return;
  }

  // Images/icons: cache-first (large and rarely change)
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);
    if (cached) return cached;

    try {
      const networkResp = await fetch(req);
      if (networkResp && networkResp.status === 200 && networkResp.type === 'basic') {
        cache.put(req, networkResp.clone());
      }
      return networkResp;
    } catch (e) {
      return Response.error();
    }
  })());
});

/* ── Web Push: show the notification when a new gift code drops ── */
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { /* keep defaults */ }
  event.waitUntil(self.registration.showNotification(data.title || '🎁 K1266', {
    body: data.body || 'New gift code available!',
    icon: './icons/icon-192.png',
    badge: './icons/icon-96.png',
    tag: 'k1266-gift-code',
    data: { url: data.url || './index.html' },
  }));
});

/* ── Focus the app (or open it) when a notification is tapped ── */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || './index.html';
  event.waitUntil((async () => {
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientList) {
      if ('focus' in client) { await client.focus(); return; }
    }
    if (self.clients.openWindow) await self.clients.openWindow(url);
  })());
});

// Allow page to trigger skipWaiting via postMessage
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
