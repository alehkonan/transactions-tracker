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
const CACHE_METADATA_URL = `/_offline-cache/${BUILD_ID}`;
const MESSAGE_TYPE = "transactions-tracker:service-worker";
const OFFLINE_RECOVERY_HTML =
  '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title><body><main><h1>Offline</h1><p>This app update is not available offline yet. Reconnect and try again.</p></main></body></html>';

/* __OUTBOX_ACCEPTANCE_KERNEL__ */

self.addEventListener("install", (event) => {
  event.waitUntil(installCompleteCache());
});

self.addEventListener("activate", (event) => {
  // Do not claim open uncontrolled documents. They keep their current navigation until the user
  // closes and reopens them, rather than being switched underneath a dirty form.
  event.waitUntil(cleanUpCaches());
});

self.addEventListener("message", (event) => {
  const message = event.data;
  if (message?.type !== MESSAGE_TYPE) return;

  if (message.action === "get-build-id") {
    event.source?.postMessage({ type: MESSAGE_TYPE, action: "build-id", buildId: BUILD_ID });
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // POSTs are live data; the page engine owns their failures.

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    const pathname =
      url.pathname.endsWith("/") && url.pathname !== "/" ? url.pathname.slice(0, -1) : url.pathname;
    if (!NAVIGATION_PATHS.has(pathname)) return;
    event.respondWith(getCachedShell());
    return;
  }

  const exactUrl = `${url.pathname}${url.search}`;
  if (PRECACHE.includes(exactUrl)) {
    event.respondWith(getCachedAsset(request));
  }
});

async function installCompleteCache() {
  const cache = await caches.open(CACHE_NAME);
  try {
    await cache.addAll(PRECACHE);
    await cache.put(
      CACHE_METADATA_URL,
      new Response(JSON.stringify({ buildId: BUILD_ID, completedAt: Date.now() }), {
        headers: { "Content-Type": "application/json" },
      }),
    );
  } catch (error) {
    await caches.delete(CACHE_NAME);
    throw error;
  }
}

async function getCachedShell() {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(SHELL_URL);
  if (cached) return cached;

  try {
    const response = await fetch(SHELL_URL, { credentials: "omit", redirect: "error" });
    const contentType = response.headers.get("Content-Type") ?? "";
    if (!response.ok || !contentType.toLowerCase().includes("text/html")) {
      throw new Error("The versioned shell response is not HTML.");
    }
    await cache.put(SHELL_URL, response.clone());
    return response;
  } catch {
    return new Response(OFFLINE_RECOVERY_HTML, {
      status: 503,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
}

async function getCachedAsset(request) {
  const cached = await (await caches.open(CACHE_NAME)).match(request);
  return cached ?? fetch(request);
}

async function cleanUpCaches() {
  const cacheNames = (await caches.keys()).filter((name) => name.startsWith(CACHE_PREFIX));
  const completeCaches = await Promise.all(
    cacheNames.map(async (name) => {
      const buildId = name.slice(CACHE_PREFIX.length);
      const metadata = await (await caches.open(name)).match(`/_offline-cache/${buildId}`);
      if (!metadata) return null;
      const { completedAt } = await metadata.json();
      return { name, buildId, completedAt: Number(completedAt) || 0 };
    }),
  );
  const complete = completeCaches
    .filter((cache) => cache !== null)
    .toSorted((left, right) => right.completedAt - left.completedAt);
  const incomplete = cacheNames.filter((name) => !complete.some((cache) => cache.name === name));

  // A partial install cannot serve a shell. Complete caches are retained until the live-client
  // handshake proves no document could need them.
  await Promise.all(incomplete.map((name) => caches.delete(name)));

  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const clientBuilds = await getLiveClientBuilds(clients);
  if (clientBuilds === null) return;

  const preservedBuilds = new Set([
    BUILD_ID,
    ...complete.slice(0, 2).map((cache) => cache.buildId),
    ...clientBuilds,
  ]);
  await Promise.all(
    complete
      .filter((cache) => !preservedBuilds.has(cache.buildId))
      .map((cache) => caches.delete(cache.name)),
  );
}

async function getLiveClientBuilds(clients) {
  if (clients.length === 0) return new Set();

  const requestId = crypto.randomUUID();
  const replies = new Map();
  const onMessage = (event) => {
    const message = event.data;
    if (
      message?.type !== MESSAGE_TYPE ||
      message.action !== "client-build-id" ||
      message.requestId !== requestId
    )
      return;
    replies.set(event.source?.id, message.buildId);
  };
  self.addEventListener("message", onMessage);
  try {
    for (const client of clients) {
      client.postMessage({ type: MESSAGE_TYPE, action: "request-client-build-id", requestId });
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  } finally {
    self.removeEventListener("message", onMessage);
  }

  // No response is not proof that a document is gone; defer eviction conservatively.
  if (
    replies.size !== clients.length ||
    [...replies.values()].some((buildId) => typeof buildId !== "string")
  ) {
    return null;
  }
  return new Set(replies.values());
}
