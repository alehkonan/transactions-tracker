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

The server keeps exactly two data endpoints (`pullChanges`, `pushChanges`) plus auth. Everything else
in `src/api/*.functions.ts` is deleted, bar `selectProfile` — which is not a data endpoint at all,
just the one thing only a server can do: sign a cookie.

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
`reconcileAccountBalances` and debugging; never send it in a pull. _(Phase 3 note: the recompute on
push made `reconcileAccountBalances` unreachable drift-wise, and it was deleted with its button. The
column stays for whatever reads the database directly.)_

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
   — `transactionsSum`, `reconcileAccountBalances` (both since folded into the push's balance
   recompute), `ownership.server.ts`, and the import's account/category lookups.
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

Still true after this phase: **mutations remain server functions** — Phase 3 moves them to the
outbox. And a genuinely offline _cold_ start still needs Phase 5's service worker: without one the
document and route chunks cannot load, however complete the local database is.

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

## Phase 3 — write path (shipped)

```
src/modules/sync/outbox.ts             # append-only {seq, mutationId, table, rowId, op, payload, baseUpdatedAt}
src/modules/sync/mutations.ts          # commit(): store + IDB + outbox, in one IDB transaction
src/modules/sync/UnsyncedChanges.tsx   # "N unsaved changes", and the beforeunload guard
src/modules/sync/SyncConflictToasts.tsx
src/api/apply-mutations.server.ts      # the rules a pushed row is put through, and the balance recompute
```

Domain code does not build mutations. It describes changes in terms of rows —
`accounts/account-mutations.ts`, `categories/category-mutations.ts`,
`transactions/transaction-mutations.ts`, `profile/profile-mutations.ts` — and hands them to
`commit`, which is the only place that knows how a local write reaches memory, IndexedDB and the
queue at once.

Everything left in `src/api/*.functions.ts` besides `sync` and `auth` is there because it is _not_ a
data endpoint: `selectProfile`, and nothing else. `reconcileAccountBalances` went too — a push
restates `accounts.balance` for every profile it writes into, so the column cannot drift from the
app, and a button to repair it was repairing nothing. `profileMiddleware` and
`getSelectedProfileIdFromCookie` went with it, since it was the last caller: the server never needs
to know which profile is _selected_, only that the one a pushed row names belongs to the caller.

That leaves the profile selection a purely client-side concern. `createSession` now clears it, which
is where the "somebody else signed in on this browser" check used to live inside the middleware —
a stale hint would otherwise convince the root guard a profile is selected and strand the new user
on a page that resolves to nothing.

### pushChanges

```
pushChanges({ mutations }) → { applied, canonicalRows, conflicts, colors }
```

- **Atomic per batch**, applied in outbox order in one DB transaction, so "create account, then
  create transaction referencing it" works and a rejected parent rejects its dependents. 500
  mutations per batch, for the same reason a pull pages at 2000 rows.
- **A mutation is a whole row, not a diff.** The client already holds the row it is changing, and
  sending all of it is what makes applying one idempotent — which is why the outbox needs no dedup
  table, and why a retry after a half-finished push is safe rather than merely likely to work.
- **Offline-first does not relax authorization.** Every pushed row re-runs the checks in
  `ownership.server.ts`, now the single choke point: `assertProfilesOwnedBy` for the profile each
  row names, and the account/category assertions for the ids a transaction is filed against. They
  take the open transaction, so a profile the same batch created a moment ago counts. The
  `on conflict do update` clauses are guarded too (`setWhere`), so a client guessing an existing
  uuid updates nothing rather than taking a stranger's row over.
- Server stamps `updated_at` (`now()`, so a batch sorts together) and recomputes `accounts.balance`
  for every profile the batch wrote into.
- **Conflicts: last-write-wins on the server clock at push time.** Single user, few devices, one
  writer at a time in practice — no CRDTs. Each mutation carries `baseUpdatedAt` so the server can
  _detect_ a clobber and return a warning, surfaced as a toast; there is no merge UI.

### Mutation flow

1. Persist row + outbox entry in one IDB transaction.
2. Apply to the store (optimistic).
3. Debounced push (~1s), then a pull.
4. Success → drop outbox entries, apply canonical rows.
5. Failure → keep outbox, retry with exponential backoff, show "N unsaved changes".

Four things this phase turned up:

1. **`baseUpdatedAt` cannot be the cursor's timestamp.** The client only ever holds the
   driver-parsed `Date`, and comparing that against a postgres value kept to the microsecond reports
   a conflict on every single edit. Both sides truncate to epoch milliseconds — the precision the
   client can actually represent.
2. **An optimistic write leaves `updatedAt` alone.** Only the server advances it. Stamping a client
   clock over it would make the _second_ edit of a row report a base the server has never heard of,
   and every edit after the first would look like a clobber.
3. **A pull must not overwrite a row with a write still queued.** The server's copy is the version
   from before the local write, so applying it reverts what the user just did until the push puts it
   back. `outbox.rowKeys` is what the merge step checks; the local copy wins until its own entry is
   confirmed.
4. **The push has to be followed by a pull.** The canonical rows settle the client's own writes, but
   nothing moves the pull cursor past them, so without it the next boot re-downloads everything this
   device just created — on the loading path rather than behind `SyncProgress`.

Two deliberate asymmetries. **Deleting an account cascades server-side**, and the client mirrors the
same cascade locally, rather than queueing an entry per transaction: one entry says what thousands
would, and deleting a well-used account should not be a minutes-long push. And **creating a profile
is the one mutation awaited all the way to the server**, because the next thing the user does is
select it, and only the server can sign the cookie that records the choice.

### The CSV import

`importTransactions` (330 lines of server function) is now `build-import-plan.ts`, a pure function
over the working set: the client already holds every account, category and color an import has to
match against, so the whole thing is decided in memory and lands in the outbox. It is instant, it
works with no connection at all, and it is finally unit-tested.

The one thing a client cannot decide is a **color id** — `colors` is keyed by a serial and shared by
every user. So a category created by an import carries `colorHex` in its payload instead;
`pushChanges` resolves it to a row (`hex` is unique, so two devices importing the same file converge
on one palette entry) and the refreshed palette rides back in the response. Until that push lands,
an imported category draws untinted.

---

## Phase 4 — sync engine (shipped)

```
src/modules/sync/sync-engine.ts   # the mutex, the triggers, the cross-tab channel
src/modules/sync/SyncStatus.tsx   # synced / syncing / N unsynced / offline, in one corner icon
```

`useSyncStore.ts` is state again — the rows, the flags, and the merge that keeps a pulled row from
overwriting a queued one. Everything about _when_ the network is touched moved to the engine, along
with `bootSync`, `pushNow`, `schedulePush` and `resetLocalData`.

**The mutex is a Web Lock, not a promise chain.** Phase 3's `enqueue` serializes one document's
work and knows nothing about any other, and a second tab is not exotic here — it is what happens
when someone opens the app again instead of switching windows. Two tabs share one IndexedDB, so two
uncoordinated pulls write over each other's cursors and two uncoordinated drains push the same
outbox entries twice. `navigator.locks` is held across the browser rather than the document, which
is exactly the scope the database has. Where it is missing (it is genuinely absent outside a secure
context) the old promise chain is the fallback.

**Triggers**, on top of boot and the post-mutation debounce: a staleness check once a minute that
syncs when the working set is more than 5 minutes old _and_ the tab is visible;
`visibilitychange` → visible, through the same check; and `online`, which resets the push backoff
rather than waiting out the rest of it. The `beforeunload` guard for a non-empty outbox moved into
the engine with them, so it holds on `/profile` too, where the indicator is not rendered.

**Tabs are kept in step over a `BroadcastChannel`.** A tab announces when IndexedDB has moved —
after a commit, after a confirmed push batch, after a pull that actually brought something back —
and its peers re-read the whole local snapshot, debounced. Whole rather than incremental because
IndexedDB is the shared truth between tabs and every write reaches disk before it reaches memory,
so a straight replace can only move a tab forward. Signing out broadcasts a second message, which
reloads the other tabs onto `/login`: the point of dropping the local copy on a shared device is
lost if the tab next door keeps showing it.

Four things this phase turned up:

1. **A pull has to read its cursor from IndexedDB, not from the store.** The store's copy is what
   _this_ tab last pulled; the tab next to it may have moved the cursor on since. Starting from the
   older one re-downloads the difference on every boot of a second tab.
2. **A no-op delta pull must not announce anything.** Announcing every completed pull instead of
   every pull that changed something meant each idle tab rebuilt its entire working set — and every
   memoized derivation over it — once every five minutes, for rows that had not moved.
3. **The status does not belong in the navbar.** The plan said to fold the `UnsyncedChanges` pill
   into it, but the bar is already five destinations wide and measured 350px of a 360px viewport
   with a status on the end. It takes the top edge instead, opposite the navigation at both
   breakpoints, and the shell reserves that strip the way it already reserves the navbar's. Two
   shapes for the two amounts of room: a full-width one-line **strip** on a phone, where edge to
   edge costs nothing and buys the space to say the state in words, and a **corner pill** from `md`
   up, an icon with a figure beside it. `SyncProgress` folded in as well — the "syncing 35%" of a
   first run is the same question as "is this saved", asked a few seconds earlier.
4. **Nothing was left to do for 401-vs-network.** The root guard has read cookies since Phase 0 and
   makes no request to fail, and the store has split "the server said no" from "the server did not
   answer" since Phase 2. The engine keeps the distinction: `unauthorized` sends the gate to
   `/login`, everything else is an error the retry schedule owns.

Still Phase 5's: a genuinely offline _cold_ start. Route chunks are fetched on navigation, so a full
page load with no connection has nothing to serve it however complete the local database is.

---

## Phase 5 — housekeeping (shipped, bar the service worker)

```
src/api/sync.functions.ts            # checkIntegrity — the third endpoint, and the only one that moves no rows
src/modules/sync/integrity.ts        # the same checksum in JavaScript, and "is this copy too old to resume"
src/modules/sync/IntegrityCheck.tsx  # the /settings control, and the one repair there is
netlify/functions/tombstone-gc.ts    # the daily sweep, and `pnpm gc:tombstones`
```

**The PWA service worker is deliberately not done.** A genuinely offline _cold_ start still has
nothing to serve the document and the route chunks, however complete the local database is; a warm
tab remains fully offline-capable, as it has been since Phase 2.

### Integrity check

```
checkIntegrity() → { profiles, accounts, categories, transactions }   # each { count, checksum }
```

The plan asked for `count` + XOR of `updated_at`. It shipped as `count` + XOR of a per-row digest,
because a timestamp on its own is not enough here: the Phase 1 migration stamped every pre-existing
row with an identical `updated_at`, so a copy holding one of those rows in place of another would
have passed. The digest folds the uuid in — **both halves of it**. A unit test caught the first
attempt using only the leading 64 bits, which for a v7 uuid is 48 bits of millisecond and 12 of
randomness: a CSV import mints thousands of ids per millisecond, so rows would have collided once
every few thousand.

Three constraints shaped the rest of it:

1. **Both ends have to compute the same number**, so the digest is arithmetic postgres and
   JavaScript can each do exactly — no `hashtextextended`, which has no counterpart in the browser.
   `updated_at` is truncated to epoch milliseconds for the reason `baseUpdatedAt` already is: the
   client only ever holds a `Date`, and anything finer would make every row disagree.
2. **Order-independent**, hence `bit_xor` rather than a running hash — the store's arrays are in
   whatever order pages and merges left them.
3. **Tombstones are excluded on both sides.** A client deletes the row rather than keeping the
   tombstone, so counting them would report a divergence on every recent deletion.

Reported, never repaired automatically. The comparison refuses to run at all while writes are queued
or a pull is still streaming — the two ends are _supposed_ to differ then — and the only repair is
`resyncFromScratch`, which drops the local rows and cursors, keeps the outbox, and pulls again from
nothing. It refuses while the outbox is non-empty, since queued writes are the one thing here a
re-pull could not bring back.

Verified against 11,584 real transactions: the SQL and the JavaScript agree on all four tables. And
a divergence has to be planted as a **phantom row** to stick — deleting a row from IndexedDB by hand
does not diverge anything, because the cursor's 10s overlap has the server re-send it on the next
pull. A delta pull only ever adds, which is exactly why a row the server has never heard of is the
one thing it cannot fix.

### Tombstone GC

`netlify/functions/tombstone-gc.ts`, `@daily`, hard-deleting `deleted_at < now() - 90 days` across
the four synced tables, children before parents. Also `pnpm gc:tombstones`, which runs the same file
directly — housekeeping that only proves itself on a deploy is housekeeping nobody checks.

Deliberately standalone: raw SQL over its own postgres client rather than `getDb()` and the Drizzle
schema, so Node can execute the file as-is and Netlify can bundle it without dragging the app's
server graph in behind it. The price is the table list, which has to be kept in step with
`SYNCED_TABLES` by hand.

No index on `deleted_at`. A daily sweep off the request path can afford a sequential scan of tables
this size, and four partial indexes would tax every write to save a job nobody is waiting for.

### The other half of a retention window

A retention window is a deadline for clients as much as for rows: once a tombstone is swept, a
device that never saw it would pull every edit and none of the deletions, and — since a pull only
adds — hold the deleted rows forever with nothing looking wrong. So a local copy whose oldest cursor
is more than **60 days** old is not resumed from at all. `pullUntilCaughtUp` drops the rows and the
cursors and starts from nothing, keeping the outbox; a full re-pull is what a device dormant for two
months was going to pay for anyway.

60 against 90 is the margin, and the two must not be allowed to converge: they are not measured by
the same clock — the cursor is rewound by the pull's overlap window and the sweep runs on its own
schedule. The wipe is also skipped while writes are queued, because those exist nowhere else and a
re-pull will not bring them back; the attempt after the push lands does it instead.

### Still open

- **PWA service worker**, as above.
- **Automatic integrity checks.** It costs a round trip and its only answer is a full re-download, so
  it stays something the user asks for. A weekly background check would be reasonable if divergence
  ever turns out to be real rather than theoretical.

---

## Risks

- **Netlify 10s function timeout on the initial pull** → keyset pagination, ~2000 rows/page.
- ~~**Tombstone GC vs. a stale client.** A client offline longer than the retention window would miss
  deletions. Detect a cursor older than retention and force a wipe + full re-pull.~~ Landed in
  Phase 5, at 60 days against the sweep's 90.
- **LWW clobber window.** A device editing offline for days overwrites newer server values on push.
  Detection only (via `baseUpdatedAt`), reported not resolved.
- **IndexedDB eviction.** Safari evicts non-installed sites after 7 days; unsynced outbox entries
  would be lost. Keep the post-mutation debounce short and warn on `beforeunload` when the outbox is
  non-empty.
- ~~**Multiple tabs** sharing one IDB → hold the sync mutex in a Web Lock, and use
  `BroadcastChannel` to keep stores in step.~~ Both landed in Phase 4.
- **Cursor gap** from commit-order vs. timestamp-order, mitigated by the overlap window above.
