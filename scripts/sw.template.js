// JK MatchPredict service worker. Generated into dist/sw.js by scripts/build.mjs, which fills in
// the version (a hash of every published file) and the list of files to keep for offline use.
//
// Strategy, chosen to be safe rather than clever:
//  - API calls, share pages, non-GET requests and other origins are never touched: they always
//    go to the network, so private data is never cached.
//  - Everything else (the app shell) is network-first, so a new deploy reaches people the next
//    time they are online; the cached copy is only a fallback when the network fails.
//  - A cache is named after the build; old ones are deleted when a new worker takes over.

const VERSION = '__VERSION__';
const CACHE = 'jk-shell-' + VERSION;
const ASSETS = __ASSETS__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.startsWith('jk-shell-') && k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/** Whether this request belongs to the app shell (and may therefore be cached). */
function isShellRequest(request) {
  if (request.method !== 'GET') return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  return !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/s/');
}

/**
 * The cache key for a request. Navigations are stored under "/" only, without their query
 * string, so one-time sign-in codes in the address are never written to the cache.
 */
function cacheKey(request) {
  if (request.mode !== 'navigate') return request.url;
  const url = new URL(request.url);
  return url.pathname === '/' ? '/' : null;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  const key = cacheKey(request);
  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic' && key) await cache.put(key, response.clone());
    return response;
  } catch (error) {
    // Only a page navigation may fall back to the shell; a missing script or stylesheet must
    // fail rather than be answered with HTML.
    const cached =
      (key && (await cache.match(key))) ||
      (request.mode === 'navigate' && (await cache.match('/')));
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener('fetch', (event) => {
  if (isShellRequest(event.request)) event.respondWith(networkFirst(event.request));
});
