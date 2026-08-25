# Offline Completeness Plan

The three items from the original checklist, turned into execution plans: the current state, the
design decisions, the exact files to touch, and how to verify each one landed. Read
`docs/architecture.md` first — the governing constraint is the offline-first flow itself: reads
come from IndexedDB/Zustand, mutations are persisted locally before they are pushed, and nothing
in this plan may change either half.

The theme: **a warm tab is already fully offline; these three items close the gap between
"offline in a tab" and "offline as a device."** A cold page load with no connection, a browser
that evicts the database, a tab that closes before the push fires — each is a hole the sync engine
knows about and works around (the short debounce, the `beforeunload` warning), not one it can fix.

**Nothing here adds a dependency.** The service worker is hand-rolled; `vite-plugin-pwa` is named
below as the documented fallback if that ever stops being tenable — a decision to make then, with
your sign-off, not now.

| #   | Item                           | Lands as                                                       | Touches                                                       | Risk                              |
| --- | ------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------- |
| 1   | PWA service worker             | `public/sw.js`, a build-time precache plugin, manifest + icons | `vite.config.ts`, `__root.tsx`, `netlify.toml`, new `public/` | medium (build + caching behavior) |
| 2   | `navigator.storage.persist()`  | one guarded call in `bootSync`, optional settings readout      | `sync-engine.ts`, `settings.tsx`                              | very low                          |
| 3   | Background Sync for the outbox | a SW `sync` handler + a thin push route it can call            | new `src/routes/api/push.ts`, `mutations.ts`, `sw.js`         | medium (new server surface)       |

Suggested order: **2 → 1 → 3**. Item 2 is a few lines and stands alone; item 1 is the foundation
item 3 builds on (there is no Background Sync without a service worker); item 3 adds the only new
server surface, on top of both.

---

## 1. PWA service worker and web app manifest

- [x] `public/sw.js` — network-first navigations, cache-first hashed assets, never cache POSTs
- [x] Precache list stamped into the SW at build time (small local Vite plugin)
- [x] `public/manifest.webmanifest` + icons (192 / 512 / maskable)
- [x] `__root.tsx` `head()`: manifest + icon links; SW registration, production only
- [x] `netlify.toml`: `Cache-Control: no-cache` for `/sw.js`
- [x] `e2e/offline-cold-start.spec.ts`, against the production build via `vite preview`

### What exists today

- No `public/` directory, no icons, no manifest, no service worker. `__root.tsx`'s `head()` carries
  only charset / viewport / title and the stylesheet link — there is not even a favicon to build
  the manifest icons from.
- `vite build` emits content-hashed asset filenames into `dist/client` (which `netlify.toml`
  publishes) — exactly the immutability a cache-first strategy wants, already true today.
- **The app shell is route-independent for every authed route.** SSR renders the same chrome-less
  loading screen everywhere behind `SyncGate` — `isHydrated` is false during SSR, "so the server
  paints the same chrome-less screen the client starts from" — and the router plus IndexedDB do
  the rest on hydration. `/login` is the one document that differs. This is what makes the
  app-shell precache pattern clean here: **one cached document can stand in for any navigation**,
  and the route guards, which read hint cookies synchronously in `beforeLoad`, keep working with
  no server in the path at all.
- Playwright is configured (`webServer` on port 5454), and the `onboardedPage` fixture from
  `e2e/fixtures/auth.ts` is the test surface this spec rides on.

### Design decisions

**Hand-rolled, not Workbox / `vite-plugin-pwa`.** The repo's character is deliberately standalone
scripts with the trade-offs written down — the tombstone GC is the precedent — and the guardrail
is to ask before adding dependencies. The only build-time magic a precache needs is the asset
list, and a ~40-line local Vite plugin covers it.

**Caching strategy**, in one table:

| Request                 | Strategy                          | Why                                                                         |
| ----------------------- | --------------------------------- | --------------------------------------------------------------------------- |
| Navigations (documents) | network-first, fall back to shell | deploys show up when online; the cached shell serves any route cold         |
| `/assets/*` (hashed)    | cache-first, precached at install | immutable by construction; no validation round trip                         |
| `sw.js`                 | never cached (Netlify header)     | the browser must see each deploy's new worker                               |
| Server function calls   | never touched by the SW           | POSTs to live data; offline they fail and the engine backs off, as designed |

**The precache list comes from the build, not from a hand-maintained array.** A `closeBundle` hook
in `vite.config.ts` walks the client build output, collects the document plus every hashed asset,
and stamps the list into `public/sw.js` at emit time. Same shape as the tombstone GC's shared
constant: one source of truth, no drift to forget. Precache **all** assets rather than just the
entry chunk — route chunks are lazy-loaded, and a cold start offline that 404s on `/statistics`
is not an offline app. The bundle is small and the cost is one-time.

Sketch of the worker (illustrative — ~60 lines of real code):

```js
// public/sw.js — PRECACHE is stamped in at build time; hand-maintaining it is the failure mode.
const VERSION = "__BUILD_ID__";
const PRECACHE = ["/", ...__ASSET_LIST__];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== VERSION).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // POSTs are live data; the engine owns their failures

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Write the fresh document back, so the cached shell is the newest one seen.
          return caches.open(VERSION).then((cache) => {
            cache.put("/", response.clone());
            return response;
          });
        })
        .catch(() => caches.match("/")),
    );
    return;
  }

  if (new URL(request.url).pathname.startsWith("/assets/")) {
    event.respondWith(caches.match(request)); // hashed filenames: immutable
  }
});
```

**Update flow: `skipWaiting()` + `clients.claim()`, and the page reloads once on
`controllerchange`** (guarded by a flag so it reloads once, not in a loop). The quieter
alternative — waiting out every open tab — leaves a client running the previous deploy's code
against a new server for as long as a tab stays open; for a single-user finance app the immediate
swap is the better trade. Write the choice down in the file, the way `schedulePush`'s comment
writes down its debounce.

**Registration: production only.** In `__root.tsx` (or a tiny client module it imports):

```ts
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  addEventListener("load", () => void navigator.serviceWorker.register("/sw.js"));
}
```

Dev registration is deliberately off: Vite's dev server serves unhashed, HMR-invalidated assets,
and a caching worker in front of that pipeline breaks reloads in ways that cost more afternoons
than this paragraph. The cost is that dev and production genuinely differ here — which is why the
spec below runs against the built app.

**Manifest and icons.** Create `public/` (Vite serves it at the site root and the Netlify plugin
publishes it with the build): `manifest.webmanifest` — `name: "Transactions tracker"` to match the
`<title>`, a `short_name`, `start_url: "/"`, `display: "standalone"`, `theme_color` /
`background_color` (pick the hex nearest the paper/ink tokens), icons at 192 and 512 plus a
maskable variant — and the icon PNGs themselves, exported from one SVG source, since the app has
no icon assets of any kind today. Wire `rel="manifest"` and the icons into `__root.tsx`'s `head()`
`links`, next to the stylesheet.

**Netlify headers**, in `netlify.toml`:

```toml
[[headers]]
  for = "/sw.js"
  [headers.values]
  Cache-Control = "no-cache"
```

Without it, the browser may serve a stale worker for up to a day on default HTTP caching, and
deploys silently stop arriving on returning devices. While there, `/assets/*` can get
`Cache-Control: "public, immutable, max-age=31536000"` — same file, additive, and correct by the
hash.

### The spec

`e2e/offline-cold-start.spec.ts`, riding the `onboardedPage` fixture from `e2e/fixtures/auth.ts` — but
against the **production build**, because the SW only registers when `import.meta.env.PROD`. Add a
dedicated Playwright project (`pwa`) with its own `webServer` — `pnpm build && pnpm preview
--port 5455` (the `preview` block in `vite.config.ts` already pins the port; give this one its
own) — so the dev-server project is untouched.

1. Through `onboardedPage`: sign in, sync, create an account — one online visit, which is exactly
   what install requires.
2. `context.setOffline(true)`, then **`page.reload()`** — a reload within the context is the
   honest cold-start simulation: a fresh document load, fresh script evaluation, everything from
   IndexedDB and the SW. Assert the boot gate opens and the account is visible.
3. Navigate to another route via the navbar, still offline — proving the route chunks are
   precached, not just the entry document.
4. Assert the sync indicator reports offline rather than error: the pull failed _behind_ a
   hydrated UI, which is the whole design.

### Out of scope (deliberately)

Push notifications, Periodic Background Sync (Chromium-and-installed only, and nothing here needs
a schedule), any offline story for a first-ever visit with no connection (install needs one
online load — inherent to the app-shell pattern, not a defect), and an "app updated" toast beyond
the one-reload flow.

### Verification

`pnpm build`, then inspect `dist/client/sw.js` — the stamped list is present and matches the
emitted assets. `pnpm preview` + DevTools: Application → Service Workers shows the worker, Cache
Storage shows one versioned precache holding the document and every asset; Lighthouse's
installable-PWA checks pass. Then the spec, run twice in a row. `pnpm typecheck` covers the plugin
code (it lives in `vite.config.ts`, already typechecked). Check the context option
`serviceWorkers: "allow"` for the project if workers seem absent in test contexts.

---

## 2. `navigator.storage.persist()` on first successful sync

- [x] One guarded call at the end of `bootSync`, after `syncNow()`
- [x] The persisted state surfaced on `/settings`

### What exists today

Nothing calls it. The eviction risk is already written down twice in the code: `schedulePush`'s
comment ("on Safari, IndexedDB for a site that has not been installed is evicted after seven days
of no visits") and the `beforeunload` warning that guards a non-empty outbox. The 1s push debounce
is itself an eviction mitigation — writes leave quickly, so little is ever at stake.

### Changes

In `bootSync` (`src/modules/sync/sync-engine.ts`), after `syncNow()` resolves:

```ts
// Eviction protection: best-effort and idempotent — the browser decides, and asking again on a
// later boot costs nothing. Covers IndexedDB and Cache Storage alike, which is the whole outbox.
void navigator.storage?.persist?.().catch(() => {});
```

Placement rationale: the plan says "on first successful sync," and `bootSync` runs once per tab
session — but there is deliberately no first-sync flag in IndexedDB. Tracking "first" would be
state to maintain for zero benefit: the call is a cheap idempotent request, so asking on every
boot is the simpler behavior with the same effect. The optional chains are the entire
compatibility story for older browsers.

**Honest framing:** `persist()` is a request, not a command. Chromium grants it on engagement and
installation heuristics — the manifest from item 1 is what tips that decision; Safari treats
installed web apps' storage as persistent. Which is why this item and item 1 are one plan rather
than two: **install + persist is the pair that actually closes the 7-day bucket**, and the
verification below treats them together.

Optional touch, worth the ten lines: on `/settings`' "Local data" section, next to
`IntegrityCheck`, read `navigator.storage.persisted()` in a `useEffect` and render one line —
"Local data is protected from automatic cleanup" / "This browser may clear local data after a
period of no use." The mitigation becomes visible instead of silent, on the one page already
about the device's copy of the data.

### Verification

DevTools → Application → Storage: "Persistent storage: granted" after one online visit. Don't
build an e2e assertion on it — headless Chromium's grant behavior differs from a real profile, so
the assertion would test the harness, not the app. Typecheck and the unit tests stay green; there
is no store, schema, or API change to test.

---

## 3. Background Sync for the outbox

- [x] `src/routes/api/push.ts` — a plain POST route the service worker can call
- [x] The mutation Zod schemas extracted to `src/api/sync-schemas.ts`, shared by both entry points
- [x] SW: `sync` handler that drains the outbox idempotently
- [x] Registration in `mutations.ts` after each queued write, feature-detected

### What exists today

The push path is entirely page-bound. `drainOutbox` runs under the Web Locks mutex inside a tab,
retries with backoff while the tab lives (`MAX_PUSH_BACKOFF_MS` 30s), and `beforeunload` warns
when writes are still queued. Close the tab with the network down and nothing leaves until a page
is open again — the one gap the engine has no answer for.

The ingredients for a SW-side drain already exist:

- the outbox is plain IndexedDB — `readOutboxBatch` / `dropOutboxEntries` live in `idb.ts`;
- mutations are whole rows, so re-apply is idempotent ("applying one twice lands on exactly the
  same state" — the property the docs already lean on for lost responses);
- auth is cookies, and a same-origin `fetch` from a service worker sends them by default.

Two constraints shape the design:

1. **The SW cannot call a TanStack server function.** `pushChanges` is an RPC whose client runtime
   lives in the page; the worker needs a plain HTTP endpoint. The repo already holds the pattern
   for exactly this — the `tanstack-start-best-practices` skill's `api-routes` rule: a file route
   with `server.handlers`, for the consumer that needs raw HTTP semantics. The SW is that
   consumer; this is the repo's first use of the pattern.
2. **The SW and a live tab can race.** The Web Locks mutex is per-page; the browser may fire the
   `sync` event while a tab is also draining. Idempotent upserts make the double push harmless;
   the SW drops only entries the server confirms — the same rule `drainOutbox` already follows.

### The route

`src/routes/api/push.ts` (run `pnpm generate-routes` after adding it):

- **POST**, validated with the same Zod schemas `sync.functions.ts` defines inline today. Extract
  `mutationSchema` and the payload schemas into `src/api/sync-schemas.ts`, imported by both the
  server function and the route — the same move as the shared tombstone constants module
  (`src/modules/sync/synced-tables.ts`), for the same reason: two entry points must not be able to disagree about
  what a mutation is.
- **Auth**: resolve the session the way every server function does. If route-handler middleware
  composes as the skill shows (`server: { middleware: [authMiddleware], handlers: … }`), use it;
  otherwise call `resolveSession()` explicitly and 401 on `null`. The answer must equal
  `pushChanges`'s, because the SW's cookies are the page's cookies — including the case where the
  access cookie has expired hours ago and the refresh path re-mints one; `resolveSession` already
  handles both branches.
- **Body**: `{ mutations: Mutation[] }`, capped at `PUSH_BATCH_LIMIT` — the same 10s function cap
  applies, and the constant is already shared via `sync-types.ts`.
- **Handler**: `applyMutations(...)` from `apply-mutations.server.ts` — the exact code path
  `pushChanges` uses — returning the same `PushChangesResult` shape. The route is deliberately a
  thin twin of the server function, minus the RPC.

Behavior rules that make it safe:

- **A 401 must not drop anything.** A dead session is not the outbox's problem; the SW leaves it
  alone and the writes go out on the next sign-in, exactly as they do today.
- **A network failure is Background Sync's whole job** — return non-2xx / let the fetch reject,
  and the browser re-fires the `sync` event on its own schedule with its own backoff.

### The service worker side

In `sw.js`:

```js
self.addEventListener("sync", (event) => {
  if (event.tag === "outbox-sync") event.waitUntil(drainOutbox());
});
```

`drainOutbox` — read a batch from the `outbox` store of the `transactions-tracker` database, POST
the mutation list to `/api/push`, drop the entries whose `mutationId` came back `applied`, loop
while the batch was full. Deliberately **not** the full `drainOutbox` from the engine: no
canonical-row write-back, no trailing pull, no store updates — the worker is the fallback path,
not a second sync engine. The next page open finishes the job the way it already does after a
lost response: the pull re-delivers the pushed rows (idempotent) and moves the cursor past them —
the same trade `pushNow`'s trailing-pull comment describes, accepted here for a path that runs
when no page exists.

Sourcing the IndexedDB constants (`DATABASE_NAME`, `OUTBOX_STORE`, the key paths) — pick one and
write the reason in the file:

- **Stamp them at build time.** The `closeBundle` plugin from item 1 already stamps the precache
  list; it stamps these constants next to it. One source of truth, zero drift, the SW stays a
  plain standalone file. **Recommended** — it is the tombstone-GC pattern again: standalone file,
  shared constants, no bundler coupling.
- **Bundle the SW as a second Vite entry** importing `idb.ts` directly. More elegant, but it
  entangles the worker's build with the Netlify/TanStack client build; try it only if the plugin
  cooperates, and fall back to stamping.

**Registration** — in `mutations.ts`, after `writeLocalMutations` persists, the same place
`announceLocalWrite()` fires:

```ts
navigator.serviceWorker?.ready
  .then((registration) =>
    "sync" in registration ? registration.sync.register("outbox-sync") : undefined,
  )
  .catch(() => {});
```

Registering on every queued write is the standard pattern: a registration replaces the same tag,
and the event fires when the browser decides the connection is back — including long after the
tab that registered it is gone, which is the entire point.

### The honest limitation

**Background Sync is Chromium-only.** Safari and Firefox do not implement the one-shot Sync API.
For Safari — the browser whose 7-day eviction motivated this whole document — item 3 changes
nothing about delivery: writes still leave on the next page open. What Safari gets from this plan
is items 1 + 2: install + persistence, so the queued writes _survive_ to be sent. That asymmetry
is the accepted trade, and the route + drain still earn their keep on every Chromium browser —
including Android, where closing the tab is the normal way to leave an app.

### Out of scope (deliberately)

Periodic Background Sync (needs the installed PWA, Chromium-only, and nothing here wants a
schedule — the outbox is empty in the common case), push notifications as a wake-up channel
(needs a push service and a server-side sender), and moving any more of the page's sync engine
into the worker than the minimal drain above.

### Verification

Manual, in Chromium DevTools, where the `sync` event has a button: Application → Service Workers
→ **Sync**. Queue a write with the network throttled offline, close the page, come back online,
and watch the outbox empty from the worker's console output. A unit test is worth it only for
whatever pure helper the drain ends up sharing with the page (e.g. a select-batch/confirm-drop
pair lifted into `idb.ts` — then test it next to `integrity.test.ts`). Playwright cannot trigger
the `sync` event directly — do not pretend otherwise in the specs.

---

## Summary

Three items, no new dependencies, the offline-first flow untouched — the SW caches only the shell
and hashed assets, and server function calls never touch Cache Storage:

- **Item 2** goes first because it is a few guarded lines in `bootSync` and stands alone: the
  eviction clock that threatens the outbox starts losing its teeth, and item 1's manifest is what
  completes it.
- **Item 1** is the foundation: one hand-rolled worker (network-first navigations, cache-first
  hashed assets, precache list stamped at build), a manifest with real icons in a new `public/`,
  and an e2e spec proving a cold start offline opens the app from IndexedDB. The app shell is
  route-independent behind `SyncGate`, which is what makes one cached document serve every route.
- **Item 3** is the only server-surface change: a thin twin of `pushChanges` at `/api/push`
  sharing the mutation schemas and `applyMutations`, a worker-side drain that drops only confirmed
  entries, honest about being Chromium-only — Safari gets survival (items 1–2), not delivery.

Deliberately not done anywhere in this plan: Workbox or `vite-plugin-pwa` (hand-rolled worker; the
plugin is the documented fallback if the worker ever grows a scheduling story), dev-mode SW
registration (Vite's dev pipeline and a caching worker do not mix), Periodic Background Sync and
push notifications (scope creep with platform costs), and any change to the push/pull protocol
itself — the worker speaks the same mutations over the same schemas, which is what keeps it from
becoming a second engine to maintain.

## Related Limitations

- **Offline cold start works after one online visit.** The worker serves the shell and every
  precached chunk with no connection; a first-ever visit with no connection still has nothing,
  because install needs one load — inherent to the app-shell pattern, not a defect.
- **IndexedDB eviction: requested, not guaranteed.** `persist()` plus installability closes
  Safari's 7-day bucket for installed users; a Chromium user who never installs still relies on
  engagement heuristics. The short push debounce and the `beforeunload` warning stay as the last
  line of defense either way.
- **Background Sync is Chromium-only.** Safari keeps today's behavior — queued writes leave on
  the next page open — but they now survive to do so. Its win from this plan is protection, not
  delivery.
- **The worker is a second code path to deploy.** `sw.js` is stamped at build; an assets-changing
  deploy activates a new worker on the next visit (`skipWaiting` + one reload), and the
  `no-cache` header on `/sw.js` is what keeps that loop closed. A deploy that changes only the
  server leaves clients' workers valid as-is.
- **`/api/push` is a new authenticated surface.** It shares the mutation schemas, the
  `applyMutations` code path, and the `PushChangesResult` shape with `pushChanges`; extracting
  the schemas into `sync-schemas.ts` is what keeps the two entry points honest.
- **Currency rates are USD-quoted and refreshed once a UTC day**, cached client-side; an unknown
  currency falls back to 1:1 rather than dropping the amount. Unchanged — and unaffected by the
  worker, which never caches the calls that carry them.
