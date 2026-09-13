// This file is a template. Vite stamps the build id, shell, precache list and portable acceptance kernel
// into the copy emitted to dist/client. Keeping the worker standalone avoids application imports.
const BUILD_ID = __BUILD_ID__;
const DATABASE_NAME = __DATABASE_NAME__;
const DATABASE_VERSION = __DATABASE_VERSION__;
const SHELL_URL = __SHELL_URL__;
const PRECACHE = __PRECACHE__;
const NAVIGATION_PATHS = new Set(__NAVIGATION_PATHS__);
if (typeof DATABASE_NAME !== "string" || !Number.isInteger(DATABASE_VERSION)) {
  throw new Error("The service worker has an invalid IndexedDB contract.");
}
const CACHE_PREFIX = "transactions-tracker-";
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_ID}`;

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

  const url = new URL(request.url);
  if (request.mode === "navigate") {
    const pathname =
      url.pathname.endsWith("/") && url.pathname !== "/" ? url.pathname.slice(0, -1) : url.pathname;
    if (!NAVIGATION_PATHS.has(pathname)) return;
    event.respondWith(fetch(request).catch(() => caches.match(SHELL_URL)));
    return;
  }

  if (url.origin === self.location.origin && PRECACHE.includes(url.pathname)) {
    event.respondWith(caches.match(request).then((cached) => cached ?? fetch(request)));
  }
});
