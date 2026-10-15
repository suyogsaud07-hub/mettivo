/* ------------------------------------------------------------------
   Mettivo service worker
   ------------------------------------------------------------------
   Caching strategy:
     - Navigations      -> network-first, falling back to the offline page
     - Static assets    -> cache-first (hashed/immutable or icon assets)
     - Everything else  -> passthrough to the network
   Requests that must never be cached (auth callbacks, RSC payloads,
   cross-origin Supabase/CDN traffic, non-GET requests) are ignored.
   ------------------------------------------------------------------ */

/*
 * Bump this whenever a cache-first asset changes.
 *
 * `v2` exists because the brand icons in `/icons/` are NOT content-hashed and
 * are served cache-first: clients that installed the previous version would keep
 * the old logo in their installed app and tab icon forever. Raising the version
 * makes `activate` drop `mettivo-static-v1` / `mettivo-pages-v1` on their next
 * visit.
 */
const VERSION = 'v2';
const STATIC_CACHE = `mettivo-static-${VERSION}`;
const PAGES_CACHE = `mettivo-pages-${VERSION}`;
const OFFLINE_URL = '/offline';

const PRECACHE_URLS = [
  OFFLINE_URL,
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
];

const KEEP_CACHES = [STATIC_CACHE, PAGES_CACHE];

/* ------------------------------ install ------------------------------ */
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PAGES_CACHE);
      // Cache entries individually: one failing URL must not abort the whole
      // install, which would leave the app with no service worker at all.
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          try {
            await cache.add(new Request(url, { cache: 'reload' }));
          } catch (err) {
            console.warn('[sw] precache skipped:', url, err);
          }
        })
      );
      await self.skipWaiting();
    })()
  );
});

/* ------------------------------ activate ----------------------------- */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Drop caches from previous versions.
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => !KEEP_CACHES.includes(key)).map((key) => caches.delete(key))
      );

      if (self.registration.navigationPreload) {
        try {
          await self.registration.navigationPreload.enable();
        } catch {
          /* not supported - non-fatal */
        }
      }

      await self.clients.claim();
    })()
  );
});

/* ------------------------------- fetch ------------------------------- */
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Never interfere with mutations.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Cross-origin (Supabase, CDNs, analytics) -> let the network handle it.
  if (url.origin !== self.location.origin) return;

  // Auth callbacks exchange a one-time code; caching them breaks sign-in.
  if (url.pathname.startsWith('/auth/')) return;

  // React Server Component payloads are request-scoped; caching them serves
  // stale UI and breaks client-side navigation.
  if (request.headers.get('RSC') === '1' || url.searchParams.has('_rsc')) return;

  // Next.js dev/HMR endpoints.
  if (url.pathname.startsWith('/_next/webpack-hmr')) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigate(event));
    return;
  }

  const isStaticAsset =
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/manifest.json';

  if (isStaticAsset) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
  }
});

/* ----------------------------- strategies ---------------------------- */
async function handleNavigate(event) {
  const { request } = event;

  try {
    // Navigation preload lets the browser start the request while the worker
    // boots, which removes the service-worker startup cost.
    const preloaded = await event.preloadResponse;
    if (preloaded) return preloaded;

    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(PAGES_CACHE);
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    const cache = await caches.open(PAGES_CACHE);
    const cached =
      (await cache.match(request)) || (await cache.match(OFFLINE_URL));
    return (
      cached ||
      new Response('You are offline.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    );
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    return new Response('', { status: 504, statusText: 'Gateway Timeout' });
  }
}

/* ------------------------------ messages ----------------------------- */
self.addEventListener('message', (event) => {
  // Lets the page activate a waiting worker immediately after an update.
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

/* -------------------------------- push ------------------------------- */
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Mettivo', body: event.data.text() };
  }

  const title = payload.title || 'Mettivo';
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    data: { url: payload.url || '/' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      for (const client of clientList) {
        if (client.url === target && 'focus' in client) return client.focus();
      }

      return self.clients.openWindow(target);
    })()
  );
});
