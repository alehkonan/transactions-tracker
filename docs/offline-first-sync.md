# Offline-first sync

Plan for moving the app's reads and writes onto IndexedDB, with PostgreSQL demoted to a sync
backend. Motivated by a shared-CPU / 500MB-RAM database that is too slow to sit on the render path.

**Decisions taken:** UUIDv7 primary keys · SSR shell with client-only data · Phase 0 ships first.

## Target shape

```
boot ─→ IDB ─→ Zustand store (full working set in memory) ─→ every read, filter and statistic
                     ↑                    │
                     │                    ↓ mutation: store + IDB + outbox, then debounced push
              pullChanges            pushChanges
                     └──── sync engine ───┘ ─→ PostgreSQL
```

The server keeps exactly two data endpoints (`pullChanges`, `pushChanges`) plus auth. Everything
else in `src/api/*.functions.ts` is deleted.

Data is small — 10k transactions is roughly 2MB — so the entire working set is held in memory and
IndexedDB is persistence only, not a query layer. All reads are synchronous.

---

## Phase 0 — quick wins (shipped)

Independent of sync. Worth measuring after, since it may account for most of the current slowness.

Landed across `perf(db): index profile-scoped lookups and shrink the connection pool` and
`perf(auth): resolve sessions and route guards without touching the database`.

### Indexes

No synced table has any index today (`src/database/tables.ts:132-163`), yet every query filters on
exactly the missing columns — `getTransactions` joins transactions→accounts and filters
`accounts.profile_id`, all sequential scans.

- `accounts(profile_id)`
- `categories(profile_id)`
- `transactions(account_id, created_at)` — composite, serves the join and the date-range filter

### Zero-DB auth

Sessions stay in the database; they just stop being _read_ on every request.

- **Access token → stateless signed cookie.** HMAC-SHA256 over `{userId, username, sessionId, exp}`
  with a new `AUTH_SECRET` env var, compared with `crypto.timingSafeEqual`. `resolveSession()`
  verifies with no DB query. Same 1h TTL, same `httpOnly` / `SameSite=Lax` / `secure` flags.
- **Refresh token → unchanged.** Still opaque, still SHA-256-hashed in `sessions`, touched once an
  hour. Revocation remains a single `DELETE`; the cost is up to 1h of staleness. Drop the access TTL
  to 15min if that window is too wide.
- `destroySession` currently matches on `access_token_hash` OR `refresh_token_hash`. With a signed
  access cookie there is no access hash — delete by `sessionId` from the verified payload. The
  `access_token_hash` / `access_token_expires_at` columns become dead; drop them in the Phase 1
  migration.
- **Signed profile cookie.** `{profileId, userId}` signed at selection time, so
  `getSelectedProfileIdFromCookie` (`selected-profile.server.ts:21-26`) drops its ownership query
  too.

Net: 0 DB queries on the auth path, down from 2–3 per navigation.

An in-memory session cache would be simpler but is wrong on Netlify Functions — per-instance and
empty on every cold start.

### Offline-tolerant routing

`__root.tsx:19-29` redirects to `/login` whenever `getSession()` fails, and offline that is a network
error rather than a logout. Add a **non-httpOnly `session_hint` cookie** (`{userId, exp}`, unsigned,
no secrets) read locally by `beforeLoad`. This is routing/UX only — real authorization stays
server-side on every sync call. It also removes an RPC round trip from SPA navigations today.

### Serverless connection tuning

`get-db.server.ts` uses postgres-js defaults (`max: 10`) and only caches the client outside
production. On a 500MB Postgres with concurrent lambdas: `max: 1`, `idle_timeout: 20`,
`connect_timeout: 10`, and cache the client on `globalThis` in production too.

---

## Phase 1 — schema for sync (shipped)

The schema could not answer "what changed since X". Four gaps, one migration —
`0007_handy_vermin.sql`, hand-written as anticipated below.

Two things the migration deliberately left for later: the `deleted_at` columns exist but nothing
writes one yet, so deletes are still hard deletes and no read filters on them — the phase that
starts writing tombstones has to add those filters in the same change. And the id default is
`gen_random_uuid()` rather than `uuidv7()`, since production is on Postgres 17.

1. **UUIDv7 primary keys** on `profiles`, `accounts`, `categories`, `transactions`. `serial` cannot
   be minted offline; without this, every optimistic insert needs a temp id plus FK rewriting on
   push — the most bug-prone part of any offline-first system. The client mints the id and it is
   final.
2. **`updated_at timestamptz not null default now()`** on all four.
3. **`deleted_at timestamptz`** tombstones. Without them, deletes are invisible to a delta pull and
   deleted rows live forever on clients. Note `transactions.account_id` is `onDelete: "cascade"` —
   soft-deleting an account must explicitly tombstone its transactions so the deletion propagates.
4. **Denormalize `profile_id` onto `transactions`** (backfill from accounts, then `not null`). Kills
   the `transactionsInProfile()` subquery (`transaction.functions.ts:150-155`) and makes the delta
   pull a single indexed scan.

Plus `(profile_id, updated_at, id)` on each synced table, keeping `(account_id, created_at)`.

**`accounts.balance` leaves the sync payload.** It is a denormalized cache two offline devices will
fight over. Derive it — `initialBalance + sum(transactions)` — computed from memory client-side and
recomputed server-side on push. This removes a whole conflict class _and_ makes every mutation
idempotent, which is why the outbox needs no dedup table. Keep the column server-side for
`reconcileAccountBalances` and debugging; never send it in a pull.

### Migration notes

- drizzle-kit will not generate a safe PK swap. Hand-write the SQL into the generated file: add
  `uuid` columns, backfill, add parallel FK columns, repoint, drop old, rename.
- Backfilled rows can use `gen_random_uuid()` (v4) — ordering only matters for rows the client
  creates, which get v7. `uuidv7()` is Postgres 18+; do not depend on it.
- Every existing row lands with the same `updated_at`, which is why the pull cursor must be
  composite (see below).
- Broad but mechanical follow-up: `z.number()` → `z.uuid()` across validators, form values, table
  columns, and the import flow.

---

## Phase 2 — read path (shipped)

Landed across `feat(sync): replicate the working set into IndexedDB` and `refactor(app): serve every
read from the working set`, with `feat(auth): carry the username in the session hint`,
`feat(sync): drop the local copy when the browser changes hands` and `fix(router): stop flashing a
spinner on every navigation` alongside.

```
src/modules/sync/sync-types.ts     # the replicated row/cursor shapes, shared by server and client
src/modules/sync/idb.ts            # idb wrapper, object stores, DB_VERSION (bump ⇒ wipe + re-pull)
src/modules/sync/useSyncStore.ts   # Zustand: full working set + sync status
src/modules/sync/SyncGate.tsx      # boot sequence + the first-run loading screen
src/modules/sync/SyncProgress.tsx  # "syncing 35%" while transactions stream in behind the app
src/api/sync.functions.ts          # pullChanges
```

Four things this phase turned up that the plan above did not anticipate:

1. **Deletes had to become tombstones here, not in Phase 3.** A delta pull can only see rows that
   still exist, so the moment reads came from a cursor, a hard `DELETE` meant the row lived on every
   client forever. `deleteAccount` / `deleteCategory` / `deleteTransactions` now set
   `deletedAt`+`updatedAt`, `deleteAccount` tombstones its transactions explicitly (the FK cascade
   only fires for real deletes), and every remaining server-side read filters `deleted_at is null`
   — `transactionsSum`, `reconcileAccountBalances`, `ownership.server.ts`, and the import's
   account/category lookups.
2. **The cursor cannot be a `Date`.** Postgres keeps microseconds, `Date` keeps milliseconds, and a
   strict cursor rounded _down_ keeps matching the rows it was meant to advance past — the first
   pull looped, re-sending the same 2000 rows indefinitely. The cursor's `updatedAt` is now the
   exact `updated_at::text`, opaque to everything except `pullChanges`, compared as a row value:
   `(updated_at, id) > ($1::timestamptz, $2::uuid)`.
3. **`colors` is pulled every time, not once.** The CSV import mints new colors for the categories it
   creates, so a client holding a pull-once palette draws them untinted. It is a few dozen rows.
4. **A rejected server function resolves, it does not throw.** TanStack Start hands back the raw
   `Response` when middleware throws one, so the 401 from `authMiddleware` arrived as a "payload"
   with no rows. The store checks for that and turns it into the `/login` redirect. `resolveSession`
   also had to start clearing the readable session hint when nothing resolves, or the guard keeps
   letting the client into an app that cannot load any data for it.

Still true after this phase: **mutations remain server functions.** Phase 3 moves them to the
outbox; until then each call site awaits `syncNow()` instead of `router.invalidate()`, since
invalidating a loader that no longer exists refetches nothing. And a genuinely offline _cold_ start
still needs Phase 5's service worker — without one the document and route chunks cannot load, however
complete the local database is.

### pullChanges

```
pullChanges({ cursors }) → { rows, nextCursors, pending, usdRates, colors }
```

`pending` is the list of tables that filled their page and have a backlog behind them (empty means
caught up). Per table rather than one `hasMore` flag because the client opens on the reference tables
and lets transactions keep arriving — it has to know which table is the one still streaming.

`withCounts` asks for `transactionBacklog`, the size of the run the client is about to make, counted
through the same predicate as the page (an index-only scan). It is the denominator behind the
"syncing 35%" indicator, and the client only asks on the first page of a run — the number does not
change during one, and a `count(*)` per page would be a real cost against a slow database.

- **Composite `(updated_at, id)` keyset cursor.** A scalar `updated_at` cursor would loop or skip
  rows, because the migration gives every existing row an identical timestamp.
- **Pagination is mandatory.** Netlify functions cap at 10s (26s background) and the DB is slow —
  cap at ~2000 rows per page and loop until nothing is `pending`.
- `usdRates` rides along in the response (the external fetch stays server-side, per
  `currency-rates.server.ts`) and is cached in IDB so statistics work offline. A rate-service outage
  returns `null` rather than failing the pull; the client keeps its cached rates.
- `colors` is a global reference table with no `profile_id` — pulled in full on every page (see note
  3 above).
- Synced: `profiles`, `accounts`, `categories`, `transactions`. Never synced: `users`,
  `credentials`, `sessions`, `webauthn_challenges`.
- Overlap the cursor by ~10s on each pull. A row whose `now()` was evaluated before another's can
  commit after it, and would otherwise be missed; upserts are idempotent so re-reading is free.

### Boot sequence

1. SSR renders the shell (no data) — which is `SyncGate`'s loading screen, so the client hydrates from
   exactly what was painted and there is no mismatch to reconcile.
2. Client opens IDB and reads `meta`.
3. Empty → full-screen "Loading your data…" → paginated full pull → write IDB → hydrate store.
4. Populated → hydrate from IDB immediately → delta sync in the background.

**Hydration is progressive: the app opens on the reference tables, not the whole working set.**
`profiles`, `accounts` and `categories` all fit in one page, so `isHydrated` flips as soon as none of
them is `pending` and the transactions stream in behind the rendered app — a cold start reaches
content in one page instead of six. Measured in dev against 11,584 transactions: reference data at
~470ms, all transactions in by ~1.8s; a warm boot reads the whole local copy in ~50ms and is
interactive at ~350ms, of which ~230ms is React hydrating.

The cost is that for that first moment every figure derived from transactions — balances, day totals,
statistics — is a partial sum still climbing. `SyncProgress` says so, as a pill with a progress bar
and a percentage of the run's backlog, rather than letting a number that is about to change look
final. Progress is counted per run, not from `transactions.length`: the latter already holds
everything replicated earlier, which would put a delta sync at "11,584 of 400".

**The navbar is hidden until the store is hydrated.** While the gate is up every destination leads to
the same loading screen, so the navigation appears with the app it navigates. `isHydrated` is false
during SSR too, so the server paints the same chrome-less screen the client starts from.

**`defaultPendingMs` must not be 0.** With no loaders left, the only thing a navigation waits for is
its own code chunk, and showing the router's pending component immediately turned every navigation
into a spinner flash that threw away the page already on screen.

### Derivations move client-side

All pure functions over the in-memory array — instant, offline, and finally unit-testable (vitest is
configured but has two test files).

| From                                         | To                                                                                                                          |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `statistics.functions.ts` (216 lines of SQL) | `modules/statistics/compute-daily-averages.ts`, `compute-monthly-spending-trend.ts`, `compute-available-spending-months.ts` |
| `getBalanceTotals`, `getProfiles` counts     | `modules/accounts/compute-balances.ts`                                                                                      |
| `getTransactions` joins + `approxAmountUsd`  | `modules/transactions/to-transaction-rows.ts`                                                                               |
| `getTransactions` date/account filters       | `modules/transactions/filter-transactions.ts`                                                                               |
| `exportTransactionsToCsv`                    | client-side, reusing `utils/to-csv.ts`                                                                                      |
| `getCategories`' color join                  | `modules/categories/to-category-rows.ts`                                                                                    |

Route loaders are stripped; `__root.tsx` keeps SSR for the shell and the `/login` route.
`statistics.functions.ts` and `color.functions.ts` are deleted outright, along with every getter in
`account`/`category`/`transaction`/`profile.functions.ts` and `getSession` — `/settings` reads the
username from the session hint cookie instead, which is also what keeps that page off the network.

Each domain exposes its slice of the working set as a hook (`useAccounts`, `useCategories`,
`useTransactionRows`) that selects the raw arrays and memoizes the derivation. Selectors must return
the arrays as-is: mapping or filtering inside one hands Zustand a new snapshot every render and the
component never settles.

---

## Phase 3 — write path

```
src/modules/sync/outbox.ts     # append-only {mutationId, table, rowId, op, payload, baseUpdatedAt}
src/modules/sync/mutations.ts  # store + IDB + outbox, in one IDB transaction
```

### pushChanges

```
pushChanges({ mutations }) → { applied, canonicalRows, conflicts }
```

- **Atomic per batch**, applied in outbox order in one DB transaction, so "create account, then
  create transaction referencing it" works and a rejected parent rejects its dependents.
- **Offline-first does not relax authorization.** Every pushed row re-runs the checks in
  `ownership.server.ts` — this becomes a single choke point instead of scattered assertions.
- Server stamps `updated_at` and recomputes `accounts.balance`.
- **Conflicts: last-write-wins on the server clock at push time.** Single user, few devices, one
  writer at a time in practice — no CRDTs. Each mutation carries `baseUpdatedAt` so the server can
  _detect_ a clobber and return a warning; surface it as a toast, do not build merge UI.

### Mutation flow

1. Apply to the store (optimistic).
2. Persist row + outbox entry in one IDB transaction.
3. Debounced push (~1s).
4. Success → drop outbox entries, apply canonical rows.
5. Failure → keep outbox, retry with backoff, show "unsynced changes".

Call sites to repoint: `useTransactionFormSubmit`, `DeleteSelectedTransactionsButton`,
`AccountForm`, `CategoryForm`, `CreateProfileButton`, `ReconcileBalancesButton`, and the CSV import
flow. The import currently chunks at 1000 rows server-side (`INSERT_CHUNK_SIZE`); offline it becomes
N outbox entries pushed in timeout-sized batches.

---

## Phase 4 — sync engine

`src/modules/sync/sync-engine.ts` — a singleton with a mutex so pushes and pulls never interleave.

**Triggers:** boot · post-mutation (debounced) · every 5min while `visibilityState === "visible"` ·
`visibilitychange` → visible when stale · `online`.

Plus: sync status in `Navbar` (synced / syncing / N unsynced / offline), conflict toasts,
`beforeLoad` distinguishing 401 from network failure, and IDB wiped on explicit sign-out (financial
data on a shared device) but kept on session expiry.

---

## Phase 5 — optional

- **PWA service worker.** Required for a genuinely offline _cold_ start — without it the shell
  itself won't load.
- **Integrity check.** Per-table `count` + XOR of `updated_at`, compared on demand. Cheap way to
  catch divergence without transferring the dataset.
- **Tombstone GC.** Delete `deleted_at < now() - 90 days`.

---

## Risks

- **Netlify 10s function timeout on the initial pull** → keyset pagination, ~2000 rows/page.
- **Tombstone GC vs. a stale client.** A client offline longer than the retention window would miss
  deletions. Detect a cursor older than retention and force a wipe + full re-pull.
- **LWW clobber window.** A device editing offline for days overwrites newer server values on push.
  Detection only (via `baseUpdatedAt`), reported not resolved.
- **IndexedDB eviction.** Safari evicts non-installed sites after 7 days; unsynced outbox entries
  would be lost. Keep the post-mutation debounce short and warn on `beforeunload` when the outbox is
  non-empty.
- **Multiple tabs** sharing one IDB → hold the sync mutex in a Web Lock, and use `BroadcastChannel`
  to keep stores in step.
- **Cursor gap** from commit-order vs. timestamp-order, mitigated by the overlap window above.
