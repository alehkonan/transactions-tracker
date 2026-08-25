# Architecture

How this app is built, and why. The short version: **it is offline-first — every read is served from
memory, every write lands locally first, and PostgreSQL is a sync backend rather than a database the
UI talks to.**

The constraint behind that shape is the database: a shared-CPU / 500MB-RAM PostgreSQL instance behind
serverless functions, too slow to sit on the render path and unreachable altogether when the user is
on a train. The working set is small — roughly 2MB for 10,000 transactions — so the whole of it is
replicated to the client and held in memory, and the database never appears in a render.

```
boot ─→ IndexedDB ─→ Zustand store (full working set) ─→ every read, filter and statistic
                          ↑                    │
                          │                    ↓ mutation: store + IDB + outbox, then debounced push
                    pullChanges            pushChanges
                          └──── sync engine ───┘ ─→ PostgreSQL
```

There are **three logical data operations in the server surface** — `pullChanges`, `pushChanges` and
`checkIntegrity` (which moves no rows at all). `pushChanges` also has a plain `/api/push` HTTP route
for the service worker; both entry points share the schemas and `applyMutations` path. Everything
else under `src/api/` is auth, or `selectProfile`, which is not a data endpoint but the one thing only
a server can do: sign a cookie.

---

## Read path

`pullChanges` → IndexedDB → Zustand store → pure derivations.

```
pullChanges({ cursors, withCounts }) → { rows, nextCursors, pending, transactionBacklog, usdRates, colors }
```

A keyset-paginated delta pull scoped to the caller's user, sending tombstones as ordinary rows with
`deletedAt` set. Synced tables: `profiles`, `accounts`, `categories`, `transactions`. Never synced:
`users`, `credentials`, `sessions`, `webauthn_challenges`.

- **The cursor is composite — `(updated_at, id)`, compared as a row value.** Rows are stamped in
  bulk: a pushed batch shares one `now()`, and so does everything a backfill touches. A scalar
  `updated_at` cursor either loops on a tie or skips the rest of it.
- **The cursor's `updatedAt` is an opaque timestamp literal, never a `Date`.** Postgres keeps
  microseconds and `Date` only milliseconds, so a strict cursor rounded _down_ keeps matching the
  rows it was meant to advance past and the pull never terminates. Nothing outside `pullChanges` may
  interpret it.
- **Pagination is mandatory** — `PULL_PAGE_SIZE` is 2000 rows, against a 10s Netlify function
  timeout. The client loops until nothing is `pending`.
- **`pending` is per table, not one `hasMore` flag**, because the app opens on the reference tables
  and lets transactions keep arriving — it has to know which table is the one still streaming.
- **The cursor is rewound ~10s on each pull.** A row whose `now()` was evaluated before another's can
  commit after it, and would otherwise fall through the gap. Upserts are idempotent, so re-reading is
  free.
- **`withCounts` asks for `transactionBacklog`** — the size of the run about to happen, counted
  through the same predicate as the page (an index-only scan). It is the denominator behind the
  "syncing 35%" indicator, and the client only asks on the first page of a run: the number does not
  change during one, and a `count(*)` per page would be a real cost against a slow database.
- **`usdRates` rides along in the response** (the external fetch stays server-side, cached per UTC
  day) and is stored in IndexedDB so statistics work offline. A rate-service outage returns `null`
  rather than failing the pull; the client keeps its cached rates.
- **`colors` is pulled in full on every page, not once.** The CSV import mints new colors for the
  categories it creates, so a client holding a pull-once palette draws them untinted. It is a few
  dozen rows.

### Boot sequence

1. SSR renders the shell with no data — which _is_ `SyncGate`'s loading screen, so the client
   hydrates from exactly what was painted and there is no mismatch to reconcile.
2. The client opens IndexedDB and reads `meta`.
3. Empty → full-screen "Loading your data…" → paginated full pull → write IDB → hydrate the store.
4. Populated → hydrate from IDB immediately → delta sync in the background.

**Hydration is progressive.** `profiles`, `accounts` and `categories` all fit in one page, so the
gate opens as soon as none of them is `pending`, and transactions stream in behind the rendered app.
Measured in dev against 11,584 transactions: reference data at ~470ms, all transactions in by ~1.8s;
a warm boot reads the whole local copy in ~50ms and is interactive at ~350ms, of which ~230ms is
React hydrating.

The cost is that for that first moment every figure derived from transactions — balances, day totals,
statistics — is a partial sum still climbing. The sync indicator says so, with a progress bar and a
percentage of the run's backlog, rather than letting a number that is about to change look final.
Progress is counted **per run**, not from `transactions.length`: the latter already holds everything
replicated earlier, which would put a delta sync at "11,584 of 400".

**The navbar is hidden until the store is hydrated** — while the gate is up, every destination leads
to the same loading screen, so the navigation appears with the app it navigates. `isHydrated` is
false during SSR too, so the server paints the same chrome-less screen the client starts from.

**`defaultPendingMs` in `router.tsx` must stay above 0.** There are no loaders, so the only thing a
navigation waits for is its own code chunk, and showing the router's pending component immediately
turns every navigation into a spinner flash that throws away the page already on screen.

### Derivations are pure functions, not queries

Every figure the app shows is computed from the in-memory arrays — instant, offline, and
unit-testable.

| Module                                            | Derives                                                  |
| ------------------------------------------------- | -------------------------------------------------------- |
| `accounts/compute-balances.ts`                    | account balances and per-currency totals                 |
| `transactions/to-transaction-rows.ts`             | table rows: account/category joins and `approxAmountUsd` |
| `transactions/filter-transactions.ts`             | the account and date-range filters                       |
| `categories/to-category-rows.ts`                  | category rows with their color                           |
| `statistics/compute-daily-averages.ts`            | daily spend averages over a period                       |
| `statistics/compute-monthly-spending-trend.ts`    | month-over-month spending                                |
| `statistics/compute-available-spending-months.ts` | the money-runway estimate                                |
| `transactions-import/build-import-plan.ts`        | the rows a parsed CSV turns into                         |
| `utils/to-csv.ts`                                 | the export                                               |

**`accounts.balance` is never replicated.** A denormalized balance is a cache two offline devices
fight over, so clients derive it from `initialBalance` plus the transactions they hold and it cannot
disagree with them. The column exists server-side — the push recomputes it, and something reading the
database directly wants it — but it never rides in a pull.

Each domain exposes its slice as a hook — `useAccounts`, `useCategories`, `useTransactionRows` —
which selects the raw store arrays and memoizes the derivation. **Never map or filter inside a
Zustand selector**: a fresh array on every render is a new snapshot, and the component never settles.

---

## Write path

`commit` → store + IndexedDB + outbox → debounced `pushChanges`.

Mutations are client-side. **Nothing calls a server function to write.** Domain code describes
changes in terms of rows — `account-mutations.ts`, `category-mutations.ts`,
`transaction-mutations.ts`, `profile-mutations.ts` — and hands them to `commit`
(`src/modules/sync/mutations.ts`), which is the only place that knows how a local write reaches
memory, IndexedDB and the queue at once. Call sites do not await the network and must not call
`syncNow()`.

```
pushChanges({ mutations }) → { applied, canonicalRows, conflicts, colors }
```

1. Persist the row and its outbox entry in one IndexedDB transaction.
2. Apply to the store (optimistic).
3. Debounced push (~1s), then a pull.
4. Success → drop the outbox entries, apply the canonical rows.
5. Failure → keep the outbox, retry with exponential backoff (capped at 30s), show "N unsaved
   changes".

- **A mutation carries the whole row, not a diff.** The client already holds the row it is changing,
  and sending all of it is what makes applying one idempotent — which is why the outbox needs no
  dedup table, and why a retry after a half-finished push is safe rather than merely likely to work.
- **Ids are minted client-side** (`utils/uuid-v7.ts`). UUIDv7 rather than `serial`, because a serial
  cannot be minted offline: without it every optimistic insert needs a temp id plus FK rewriting on
  push, the most bug-prone part of any offline-first system. The client mints the id and it is final.
- **A batch is atomic** — 500 mutations, applied in outbox order in one DB transaction, so "create
  account, then create a transaction referencing it" works and a rejected parent rejects its
  dependents.
- **An optimistic write leaves `updatedAt` alone.** Only the server advances it. It is the client's
  record of what it last saw; a client clock stamped over it makes the _second_ edit of a row report
  a base the server has never heard of, and every edit after the first looks like a clobber.
- **`baseUpdatedAt` is epoch milliseconds**, on both sides. The client only ever holds a
  driver-parsed `Date`; compared against a postgres value kept to the microsecond, every single edit
  reports a conflict.
- **A pull must not overwrite a row with a write still queued.** The server's copy is the version
  from before the local write, so applying it reverts what the user just did until the push puts it
  back. `mergeRows` skips anything in the outbox's `rowKeys`; the local copy wins until its own entry
  is confirmed.
- **The push is followed by a pull.** The canonical rows settle the client's own writes, but nothing
  moves the pull cursor past them — without it, the next boot re-downloads everything this device
  just created, on the loading path rather than behind the progress indicator.

### Authorization

**Offline-first does not relax authorization.** `apply-mutations.server.ts` re-runs every check on
every pushed row, via `ownership.server.ts` (all throwing 403):

- the profile a row names is proven to be the caller's (`assertProfilesOwnedBy`), inside the open
  transaction, so a profile the same batch created a moment ago counts;
- the account and category a transaction is filed against are proven to be in that profile;
- every `on conflict do update` is guarded by a `setWhere`, so a client guessing an existing uuid
  updates nothing rather than taking a stranger's row over.

**Record ids from the client are never trusted on their own.** Every synced row names the profile it
belongs to, and that claim is what gets checked. Transactions carry a denormalized `profileId` and
scope directly on it — every write has to set it to the owning account's profile, since nothing in
the database enforces that the two agree.

There is no profile middleware: the server never needs to know which profile is _selected_, only that
the one a row names belongs to the caller.

### Conflicts

**Last-write-wins on the server clock at push time.** Single user, few devices, one writer at a time
in practice — no CRDTs. Each mutation carries `baseUpdatedAt` so the server can _detect_ a clobber
and return a warning, surfaced as a toast. There is no merge UI: conflicts are reported, never
resolved.

### Two deliberate asymmetries

- **Deleting an account cascades server-side**, and the client mirrors the same cascade locally
  rather than queueing an entry per transaction. One entry says what thousands would, and deleting a
  well-used account should not be a minutes-long push.
- **Creating a profile is the one mutation awaited all the way to the server**, because the next
  thing the user does is select it, and only the server can sign the cookie that records the choice.

### The CSV import

`build-import-plan.ts` is a pure function over the working set: the client already holds every
account, category and color an import has to match against, so the whole thing is decided in memory
and lands in the outbox. Instant, works with no connection at all, and unit-tested.

The one thing a client cannot decide is a **color id** — `colors` is keyed by a serial and shared by
every user. So a category created by an import carries `colorHex` in its payload instead;
`pushChanges` resolves it to a row (`hex` is unique, so two devices importing the same file converge
on one palette entry) and the refreshed palette rides back in the response. Until that push lands, an
imported category draws untinted.

---

## The sync engine

`src/modules/sync/sync-engine.ts` is **the only module that calls a sync endpoint**, and it holds a
**Web Lock** while it does.

**The mutex is a Web Lock, not a promise chain.** A promise chain serializes one document's work and
knows nothing about any other, and a second tab is not exotic here — it is what happens when someone
opens the app again instead of switching windows. Two tabs share one IndexedDB, so two uncoordinated
pulls write over each other's cursors and two uncoordinated drains push the same outbox entries
twice. `navigator.locks` is held browser-wide, which is exactly the scope IndexedDB has. Where it is
missing (genuinely absent outside a secure context) a promise chain is the fallback.

For the same reason, **a pull reads its cursor from IndexedDB, not from the store.** The store's copy
is what _this_ tab last pulled; the tab next to it may have moved the cursor on since.

**Triggers**, on top of boot and the post-mutation debounce:

- a staleness check once a minute, which syncs when the working set is more than 5 minutes old _and_
  the tab is visible;
- `visibilitychange` → visible, through the same check;
- `online`, which resets the push backoff rather than waiting out the rest of it.

The `beforeunload` guard for a non-empty outbox lives in the engine rather than in a component, so it
holds on every screen — including `/profile`, where the indicator is not rendered.

**Tabs are kept in step over a `BroadcastChannel`.** A tab announces when IndexedDB has moved — after
a commit, after a confirmed push batch, after a pull that actually brought something back — and its
peers re-read the whole local snapshot, debounced. Whole rather than incremental, because IndexedDB
is the shared truth between tabs and every write reaches disk before it reaches memory, so a straight
replace can only move a tab forward. **A no-op delta pull announces nothing**: an announcement per
completed pull, rather than per pull that _changed_ something, has every idle tab rebuild its entire
working set and every memoized derivation over it once every five minutes, for rows that have not
moved.

Signing out broadcasts a second message, which reloads the other tabs onto `/login` — the point of
dropping the local copy on a shared device is lost if the tab next door keeps showing it.

**A server function that a middleware rejects resolves with a raw `Response`; it does not throw.**
TanStack Start hands the response back as a value, so the 401 from `authMiddleware` arrives as a
"payload" with no rows. `unauthorized` sends the gate to `/login`; everything else is an error the
retry schedule owns.

### The status indicator

`SyncStatus.tsx` takes the top edge, opposite the navigation at both breakpoints, and the shell
reserves that strip the way it reserves the navbar's. It is deliberately not in the navbar: that bar
is five destinations wide and a status on the end measures 350px of a 360px viewport. Two shapes for
the two amounts of room — a full-width one-line **strip** on a phone, where edge to edge costs
nothing and buys the space to say the state in words, and a **corner pill** from `md` up, an icon
with a figure beside it. First-run progress lives here too: "syncing 35%" is the same question as "is
this saved", asked a few seconds earlier.

---

## Deletes, tombstones and retention

**Deletes are tombstones, never `DELETE`.** A row that simply vanishes is invisible to a delta pull
and lives on every client forever, so a delete mutation sets `deletedAt` + `updatedAt`.
Correspondingly, **every server-side read filters `deleted_at is null`**. Deleting an account
cascades to its transactions server-side, explicitly — the FK cascade only fires for real deletes.

**Tombstones are swept after 90 days** by `netlify/functions/tombstone-gc.ts`, a Netlify scheduled
function running `@daily`, deleting children before parents. Also runnable by hand with
`pnpm gc:tombstones` — housekeeping that only proves itself on a deploy is housekeeping nobody
checks.

It is deliberately standalone: raw SQL over its own postgres client, no `getDb()` and no Drizzle
schema, so Node can execute the file as-is and Netlify can bundle it without dragging the app's
server graph in behind it. It imports only the dependency-free `src/modules/sync/synced-tables.ts`
module, which provides the parent-first sync order, child-first sweep order and the 60/90-day
retention constants. An invariant test keeps the two table lists in step. There is no index on
`deleted_at`: a daily sweep off the request path can afford a sequential scan of tables this size,
and four partial indexes would tax every write to save a job nobody is waiting for.

**A retention window is a deadline for clients too.** Once a tombstone is gone, a device that never
saw it pulls every edit and none of the deletions, and — since a pull only ever adds — holds the
deleted rows forever with nothing looking wrong. So a local copy whose oldest cursor is past
`STALE_CURSOR_AFTER_DAYS` (**60**) is not resumed from at all: the engine drops the rows and cursors
and pulls from nothing, keeping the outbox. A full re-pull is what a device dormant for two months
was going to pay for anyway.

**60 against 90 is the margin, and the two must never be allowed to converge.** They are not measured
by the same clock — the cursor is rewound by the pull's overlap window, and the sweep runs on its own
schedule. The wipe is skipped while writes are queued, since those exist nowhere else; the attempt
after the push lands does it instead.

---

## Divergence is detected, not prevented

```
checkIntegrity() → { profiles, accounts, categories, transactions }   # each { count, checksum }
```

`modules/sync/integrity.ts` computes the identical digest over the store, and the two implementations
have to agree bit for bit. Three constraints shape it:

1. **Both ends have to compute the same number**, so the digest is arithmetic postgres and JavaScript
   can each do exactly — no `hashtextextended`, which has no counterpart in the browser. `updated_at`
   is truncated to epoch milliseconds for the reason `baseUpdatedAt` is: the client only ever holds a
   `Date`, and anything finer makes every row disagree.
2. **Order-independent**, hence `bit_xor` rather than a running hash: the store's arrays are in
   whatever order pages and merges leave them.
3. **Tombstones are excluded on both sides.** A client deletes the row rather than keeping the
   tombstone, so counting them reports a divergence on every recent deletion.

The digest folds in **both halves of the uuid** alongside the timestamp. The timestamp alone is not
enough — rows are stamped in bulk, so a copy holding one same-timestamp row in place of another would
pass. Neither is the leading half of the uuid: for a v7 that is 48 bits of millisecond and 12 of
randomness, and a CSV import mints thousands of ids per millisecond, so rows collide once every few
thousand. A unit test pins this.

Reported on `/settings`, run on request. The comparison refuses to run at all while writes are queued
or a pull is still streaming — the two ends are _supposed_ to differ then. The only repair is
`resyncFromScratch`, which drops the local rows and cursors, keeps the outbox, and pulls again from
nothing; it refuses while the outbox is non-empty, since queued writes are the one thing here a
re-pull cannot bring back.

Verified against 11,584 real transactions: the SQL and the JavaScript agree on all four tables. Note
that a divergence has to be a **phantom row** to stick — deleting a row from IndexedDB by hand
diverges nothing, because the cursor's 10s overlap has the server re-send it on the next pull. A
delta pull only ever adds, which is exactly why a row the server has never heard of is the one thing
it cannot fix.

---

## Auth

**Passkeys (WebAuthn) only**, via `@simplewebauthn`. `src/api/auth.functions.ts` runs both
ceremonies; `webauthn.server.ts` holds the RP config and the single-use challenge store.
`sessionMiddleware` injects `context.user` (nullable); `authMiddleware` requires it and 401s
otherwise.

**The auth path costs zero queries in the common case**, because the database is the slow part.
`session.server.ts` mints two cookies, both `httpOnly` / `SameSite=Lax`:

- a **stateless signed access cookie** (1h) carrying `{sessionId, userId, username, expiresAt}`,
  HMAC-SHA256'd with `AUTH_SECRET` by `signed-cookie.server.ts` and compared with
  `crypto.timingSafeEqual`. Nothing secret may go in one: signing proves origin but does not hide the
  payload.
- an **opaque refresh token** (24h), the only thing stored SHA-256-hashed in `sessions`.

`resolveSession()` verifies the access cookie with no query and only touches the database once an
hour to re-issue it; the 24h refresh deadline does not slide. The cost is that revoking a session (a
single `DELETE`) takes effect when the access cookie next expires. An in-memory session cache would
be simpler but is wrong on Netlify Functions — per-instance, and empty on every cold start.

**Route guards read cookies, never the network.** `__root.tsx`'s `beforeLoad` is synchronous and
checks two non-`httpOnly` hint cookies via the isomorphic `readCookie`:

- `session_hint` — `{exp, username}`; the username is what lets `/settings` name the signed-in user
  offline;
- `profile_hint` — the selected profile id.

Navigation therefore costs no RPC and the app still opens offline. **The hints are forgeable and
carry no authority**: they only decide what renders, and every server function re-proves the caller.
Each hint has an `httpOnly` counterpart that is the real thing, and the two must be written and
cleared together — a hint that outlives its counterpart strands the user on a page that resolves to
nothing. `createSession` clears the profile selection, which is what catches "somebody else signed in
on this browser".

WebAuthn's secure-context rule means dev only works over `localhost`, not the LAN host Vite also
serves on.

---

## Data layer

`src/database/schema.ts` is the single source of truth for tables and enums; migrations are generated
into `src/database/migrations/` by drizzle-kit. `drizzle.config.ts` and `get-db.server.ts` both read
discrete `POSTGRES_USER` / `PASSWORD` / `HOST` / `PORT` / `DB` variables (not a `DATABASE_URL`).

`get-db.server.ts` exposes `getDb()`, a lazily-initialized Drizzle singleton with **no top-level side
effects**, so the TanStack Start compiler can tree-shake the postgres driver out of the client
bundle. Never create the connection at module scope. Serverless tuning: `max: 1`, `idle_timeout: 20`,
`connect_timeout: 10`, cached on `globalThis` in production too.

Every synced table carries `id uuid` (v7 from clients), `updated_at timestamptz not null default
now()`, `deleted_at timestamptz`, and a `(profile_id, updated_at, id)` index; transactions keep
`(account_id, created_at)` as well. Money is `numeric(14,2)` in postgres and a **decimal string** in
every payload — `utils/money.ts` does the arithmetic over integer cents, so a long list of amounts
cannot drift.

**Use `db:generate` followed by `db:migrate` for every database.** Do not use `db:push`: it applies
the schema diff without recording anything in `drizzle.__drizzle_migrations`, so the database looks
unmigrated to `db:migrate`, which then replays old migrations and fails on the first already-applied
statement — with the error swallowed by drizzle-kit, leaving only a bare exit code 1.

Production runs Postgres 17 and local dev runs 18, so the id default is `gen_random_uuid()`:
`uuidv7()` is an 18-only builtin. Ordering only matters for rows clients create, and those carry a
client-minted v7.

Input validation lives next to the server function, as a Zod schema passed to `.validator(...)` in
the same `src/api/*.functions.ts` file. The push mutation schema is the exception: it lives in
`src/api/sync-schemas.ts` because the page RPC and the service worker's `/api/push` route must accept
exactly the same protocol.

---

## Directory layout

```
src/
├── api/          # server functions (*.functions.ts), middleware, server-only helpers (*.server.ts)
├── components/   # shared presentational primitives and app chrome
├── database/     # Drizzle schema, migrations, getDb()
├── modules/      # self-contained domain UI/logic, grouped by feature
│   └── sync/     # idb.ts, useSyncStore.ts, sync-engine.ts, mutations.ts, outbox.ts, integrity.ts
├── routes/       # file-based routes; __root.tsx is the SSR shell
├── utils/        # generic helpers with no server/DB dependency
└── styles.css    # Tailwind theme tokens and the z-index scale
netlify/functions/tombstone-gc.ts   # the daily sweep
```

A domain that writes owns a `<domain>-mutations.ts` alongside its UI. A sub-feature that outgrows its
parent domain folder is promoted to its own sibling module (`transaction-form/` is a sibling of
`transactions/`).

---

## Constants worth knowing

| Constant                    | Value      | Where                               | Why                                   |
| --------------------------- | ---------- | ----------------------------------- | ------------------------------------- |
| `PULL_PAGE_SIZE`            | 2000 rows  | `api/sync.functions.ts`             | 10s Netlify function timeout          |
| `CURSOR_OVERLAP_MS`         | 10s        | `api/sync.functions.ts`             | commit-order vs. timestamp-order gap  |
| `PUSH_BATCH_LIMIT`          | 500        | `modules/sync/sync-types.ts`        | one atomic DB transaction per batch   |
| `STALE_CURSOR_AFTER_DAYS`   | 60         | `modules/sync/sync-types.ts`        | must stay well inside the sweep's 90  |
| `RETENTION_DAYS`            | 90         | `netlify/functions/tombstone-gc.ts` | tombstone sweep                       |
| push debounce / max backoff | ~1s / 30s  | `modules/sync/sync-engine.ts`       | a burst of edits leaves as one batch  |
| staleness check / threshold | 60s / 5min | `modules/sync/sync-engine.ts`       | only while the tab is visible         |
| access / refresh TTL        | 1h / 24h   | `api/session.server.ts`             | one DB touch an hour on the auth path |
