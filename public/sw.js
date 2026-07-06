/**
 * PawnPrint service worker — runtime caching so the app (including the ~7MB Stockfish engine)
 * works offline after the first visit. No build-time precache list: Vite's content-hashed
 * filenames change on every build, so instead every same-origin GET is cached the first time it's
 * fetched (stale-while-revalidate) and served from cache on later visits, including offline.
 *
 * Never cached: non-GET requests, cross-origin requests (lichess, etc.), and this app's own
 * /api/ calls — those need a real network round-trip and already have their own error handling
 * for when the network isn't there.
 */

// Bump this on any change to this file's caching behavior, to drop old caches on activate.
const CACHE_NAME = 'pawnprint-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/api/')) {
    return; // let the browser handle it normally — network only
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(req);
      const networkFetch = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);

      if (cached) {
        // Serve the cached copy immediately; refresh it in the background for next time.
        event.waitUntil(networkFetch);
        return cached;
      }
      const fresh = await networkFetch;
      return fresh || new Response('Offline and not cached yet.', { status: 503, statusText: 'Offline' });
    })
  );
});
