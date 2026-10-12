// Sky Studio service worker (web version only). It keeps a copy of the app so it also opens without internet,
// but always asks the site for the newest files first, so updates arrive as soon as they are published.
// It never sends anything anywhere except to the site the app was loaded from.
const CACHE = 'skystudio-files';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.endsWith('/version.json')) return;
  e.respondWith((async () => {
    try {
      const res = await fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' });
      if (res.status === 200) { const c = await caches.open(CACHE); c.put(req.url, res.clone()).catch(() => {}); }
      return res;
    } catch (err) {
      const hit = await caches.match(req.url, { ignoreSearch: true });
      if (hit) return hit;
      throw err;
    }
  })());
});
