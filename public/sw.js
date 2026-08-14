const CACHE_NAME = "nutritrack-v2";

// Cache the app shell on install
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Clear old caches
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
      )
    ).then(() => clients.claim())
  );
});

// Network-first strategy. Only handle same-origin GET requests; everything
// else (API, auth, cross-origin scripts like Google sign-in, non-GET) passes
// through untouched.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/auth/")
  ) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Populate the cache so the offline fallback has something to serve.
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(async () => {
        // Never resolve to undefined — respondWith(undefined) throws
        // "Failed to convert value to 'Response'". Fall back to cache, then
        // to a real error Response.
        const cached = await caches.match(event.request);
        return cached || Response.error();
      })
  );
});
