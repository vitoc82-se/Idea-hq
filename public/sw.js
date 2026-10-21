// Idea HQ service worker (makes the app installable and gives a friendly offline page).
//
// It caches ONLY public files that are the same for everyone: the built scripts and styles, icons and the
// manifest. It never stores pages, API answers or anything else that belongs to a signed-in person. Before,
// every page was kept for offline use, so after signing out (or on a shared computer) the next person could
// open the last person's pages from the cache.
const CACHE_NAME = "idea-hq-v2";
const OFFLINE_URL = "/offline.html";

// Public, identical for everyone.
const isPublicAsset = (path) =>
  path.startsWith("/_next/static/") ||
  path.startsWith("/icons/") ||
  path === "/manifest.json" ||
  path === OFFLINE_URL;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.add(OFFLINE_URL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  // Delete every older cache: the v1 one holds pages from before this fix.
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only same-origin GETs. API calls, sign-in, other sites and every other method pass straight through.
  if (req.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) {
    return;
  }

  // A page: always from the network. When there is no network, a plain offline page, never a stored copy of a page.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(async () => (await caches.match(OFFLINE_URL)) || Response.error())
    );
    return;
  }

  // Public files: network first, kept for next time.
  if (isPublicAsset(url.pathname)) {
    event.respondWith(
      fetch(req)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return response;
        })
        .catch(async () => (await caches.match(req)) || Response.error())
    );
  }
  // Anything else (page data requests, images from uploads, ...) is not touched and not stored.
});
