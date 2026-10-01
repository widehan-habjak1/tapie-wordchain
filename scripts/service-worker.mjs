export const createServiceWorker = (cacheName, assets) => `const CACHE = "${cacheName}";
const ASSETS = ${JSON.stringify(assets)};
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(async names => {
    const old = names.filter(name => name.startsWith("tapie-shell-") && name !== CACHE);
    await Promise.all(old.slice(0, -1).map(name => caches.delete(name)));
    await self.clients.claim();
  }));
});
self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request, { signal: AbortSignal.timeout(2000) }).catch(async () => (await caches.open(CACHE)).match("/")));
  } else if (ASSETS.includes(url.pathname)) {
    event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(url.pathname)) || fetch(request)));
  }
});
`
