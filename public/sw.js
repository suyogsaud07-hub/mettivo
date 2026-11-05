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

const VERSION = 'v3';
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
    const preloaded = await event.preloadResponse;
    if (preloaded) return preloaded;

    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(PAGES_CACHE);
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    // Network failed: try the cache, then the offline page, then a plain text
    // fallback so the user is never left with a browser "Unable to connect"
    // screen.
    const cache = await caches.open(PAGES_CACHE);
    const cached =
      (await cache.match(request)) ||
      (await cache.match(OFFLINE_URL));
    if (cached) return cached;

    return new Response(
      '<!doctype><html><body style="background:#131017;color:#F2E9E4;font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center;padding:2rem"><div style="font-size:2rem;font-weight:700;margin-bottom:0.5rem">You&apos;re offline</div><p style="color:#B58A83;max-width:320px">Mettivo needs a connection to load new content. Check your network and try again.</p><button onclick="location.reload()" style="margin-top:1rem;background:#D4B18A;color:#17121C;border:none;border-radius:30px;padding:12px 32px;font-weight:700;cursor:pointer">Try again</button></body></html>',
      {
        status: 503,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }
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
    badge: payload.badge || '/icons/badge-96.png',
    data: {
      url: payload.url || '/',
      match_id: payload.match_id,
      sender_id: payload.sender_id,
    },
    tag: payload.tag || 'mettivo-message',
    renotify: payload.renotify !== false,
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/* ----------------------------- notification click -------------------- */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const target = data.url || '/';

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      // If the app is already open on the target URL, focus it.
      for (const client of clientList) {
        if (client.url === self.location.origin + target && 'focus' in client) {
          return client.focus();
        }
      }

      // Otherwise open the target URL.
      return self.clients.openWindow(target);
    })()
  );
});
