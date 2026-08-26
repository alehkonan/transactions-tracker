/* eslint-disable no-await-in-loop -- batches must drain sequentially to preserve outbox order. */

// This file is a template. Vite stamps the build id, precache list and IndexedDB constants into the
// copy emitted to dist/client. Keeping the worker standalone means it can run after the page closes.
const BUILD_ID = __BUILD_ID__;
const CACHE_PREFIX = "transactions-tracker-";
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_ID}`;
const PRECACHE = ["/", ...__PRECACHE__];
const DATABASE_NAME = __DATABASE_NAME__;
const DATABASE_VERSION = __DATABASE_VERSION__;
const OUTBOX_STORE = "outbox";
const PUSH_BATCH_LIMIT = 500;
const SYNC_LOCK = "transactions-tracker:sync";

/* __OUTBOX_ACCEPTANCE_KERNEL__ */
const drainOutboxKernel = __outboxAcceptanceKernel.drainOutbox;

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

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
    request.addEventListener("blocked", () => reject(new Error("The local database is blocked.")));
  });
}

function readBatch(database, limit) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(OUTBOX_STORE, "readonly");
    const request = transaction.objectStore(OUTBOX_STORE).getAll(null, limit);
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
  });
}

function dropEntries(database, seqs) {
  if (seqs.length === 0) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(OUTBOX_STORE, "readwrite");
    const store = transaction.objectStore(OUTBOX_STORE);
    for (const seq of seqs) store.delete(seq);
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("error", () => reject(transaction.error));
    transaction.addEventListener("abort", () => reject(transaction.error));
  });
}

async function sendWorkerPush(mutations) {
  let response;
  try {
    response = await fetch("/api/push", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mutations }),
    });
  } catch (error) {
    return { kind: "retryable", error };
  }

  // A session may expire while the tab is closed. Keep the outbox: a later sign-in will send it.
  if (response.status === 401) return { kind: "unauthorized" };
  if (!response.ok)
    return { kind: "retryable", error: new Error(`Push failed with status ${response.status}.`) };

  let result;
  try {
    result = await response.json();
  } catch (error) {
    return { kind: "retryable", error };
  }
  if (!result || !Array.isArray(result.applied)) {
    return { kind: "retryable", error: new Error("The server returned an invalid push receipt.") };
  }

  return { kind: "accepted", result };
}

function withExclusive(work) {
  const locks = typeof navigator !== "undefined" && "locks" in navigator ? navigator.locks : null;
  return locks ? locks.request(SYNC_LOCK, work) : work();
}

async function drainOutbox() {
  const database = await openDatabase();
  try {
    const outcome = await drainOutboxKernel({
      storage: {
        readBatch: (limit) => readBatch(database, limit),
        dropEntries: (seqs) => dropEntries(database, seqs),
      },
      batchLimit: PUSH_BATCH_LIMIT,
      toPayload: ({ seq: _seq, ...mutation }) => mutation,
      send: sendWorkerPush,
      withExclusive,
    });

    // An expired session leaves the entries in place for a later authenticated trigger.
    if (outcome.kind === "retryable") throw outcome.error;
  } finally {
    database.close();
  }
}

self.addEventListener("sync", (event) => {
  if (event.tag === "outbox-sync") event.waitUntil(drainOutbox());
});
