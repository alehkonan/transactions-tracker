// This file is a template. Vite stamps the build id, precache list and portable acceptance kernel
// into the copy emitted to dist/client. Keeping the worker standalone avoids application imports.
const BUILD_ID = __BUILD_ID__;
const CACHE_PREFIX = "transactions-tracker-";
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_ID}`;
const PRECACHE = ["/", ...__PRECACHE__];

/* __OUTBOX_ACCEPTANCE_KERNEL__ */

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)));
  // A new worker should take over immediately. The controller-change handler in the page reloads
  // once so open tabs do not keep running the previous deploy's code against the new server.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // POSTs are live data; the page engine owns their failures.

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (!response.ok) return response;
          return caches.open(CACHE_NAME).then((cache) => {
            cache.put("/", response.clone());
            return response;
          });
        })
        .catch(() => caches.match("/")),
    );
    return;
  }

  const url = new URL(request.url);
  if (url.origin === self.location.origin && url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            void caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
          }
          return response;
        });
      }),
    );
  }
});
