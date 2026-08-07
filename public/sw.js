const CACHE_NAME = "ai4sci-map-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.add(self.registration.scope)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request, cacheKey) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(cacheKey ?? request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(cacheKey ?? request);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;

  // Navigations are cached under the app's scope URL rather than the exact
  // request URL, since this is a single-page app -- every navigation serves
  // the same shell regardless of query string (?concept=..., ?kind=..., ...).
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, self.registration.scope));
    return;
  }

  // graph.json is the one same-origin asset that isn't content-hashed, so it
  // needs network-first (freshness) rather than cache-first like everything
  // else (immutable hashed bundles, icons).
  if (new URL(request.url).pathname.endsWith("/graph.json")) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});
