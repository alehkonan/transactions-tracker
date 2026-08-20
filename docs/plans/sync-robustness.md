# Sync Robustness Plan

The four items from the original checklist, turned into execution plans: the current state, the
design decisions, the exact files to touch, and how to verify each one landed. Read
`docs/architecture.md` first — three of its rules govern everything here: **last-write-wins on
the server clock is the whole conflict policy**, **divergence is detected rather than prevented**
(and repair is never automatic), and **a mutation is a whole row, which is what makes re-applying
one safe**.

The common thread: none of these items changes the sync protocol's _correctness_ — they sharpen
its _honesty_. What was reported vaguely gets reported precisely; what was checked on demand gets
checked on a schedule; what was safe-by-idempotency gets safe-and-recognized; what was slow gets
measured and then cut.

**No new dependencies.** One new server-only table (item 4), one new meta key (item 2), pure
functions and UI elsewhere.

| #   | Item                                 | Lands as                                                       | Touches                                                                               | Risk   |
| --- | ------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------ |
| 1   | Field-level conflict reporting       | enriched conflicts in the store, a pure diff, a resolution UI  | `sync-engine.ts`, `useSyncStore.ts`, `SyncConflictToasts.tsx`, new `conflict-diff.ts` | medium |
| 2   | Periodic background integrity check  | a weekly gate inside the existing staleness loop, a meta key   | `sync-engine.ts`, `idb.ts`                                                            | low    |
| 3   | Compress / trim the initial pull     | measurement first, a tombstone-skip predicate, payload options | `sync.functions.ts`                                                                   | low    |
| 4   | Retire pushed entries by mutation id | an `applied_mutations` ledger inside `applyMutations`          | `tables.ts`, `apply-mutations.server.ts`, `tombstone-gc.ts`                           | medium |

Suggested order: **3 → 2 → 4 → 1**. Item 3 starts with a measurement that may close half of it
with zero code; item 2 is a self-contained client change; item 4 must land _before_ item 1,
because the ledger is what stops a retried push from raising a false conflict — building the
field-level UI on top of inputs that occasionally lie about whose write won would be building it
backwards.

---

## 1. Field-level conflict reporting, with a choice

- [ ] Enrich conflicts in `drainOutbox`: local payload + server row, joined client-side
- [ ] `conflict-diff.ts` (+ unit test) — a pure per-table field diff
- [ ] A resolution UI replacing today's generic toast: the differing fields, "Keep mine" /
      "Keep theirs"
- [ ] Conflicts persist in the store until decided, not until a toast times out

### What exists today

Detection is precise; reporting is a shrug. `findConflicts` in `apply-mutations.server.ts`
compares each mutation's `baseUpdatedAt` against the row's stored `updatedAt` and emits a
`PushConflict = { mutationId, table, rowId, serverUpdatedAt }` — no field data crosses the wire.
`drainOutbox` appends these to the store, and `SyncConflictToasts` renders one generic toast
("Overwrote a newer change … Your version was kept") that clears itself immediately. The user
cannot know _what_ was overwritten, and by the time the toast is gone, neither can the app: the
store already holds the server's row (`canonicalRows` are applied right after), and the outbox
entry carrying the user's values is dropped once confirmed.

The resolution policy itself stays exactly as documented — last-write-wins at push time, no
CRDT, no merge. What changes is that the loser gets one honest look at both versions and one
click to re-open the case.

### The key finding: no wire change is needed

At the moment `drainOutbox` receives `result.conflicts`, it is holding everything the diff needs:

- **"Mine"** — the batch entries it just pushed, each carrying its full `payload`, keyed by
  `mutationId`;
- **"Theirs"** — `result.canonicalRows`, which includes every pushed row (the server applies
  every mutation and reads back exactly what it touched, so a conflicted row is in there as the
  server now holds it).

So the enrichment is a client-side join in `drainOutbox`, before the conflicts go into the store:

```
type ConflictWithSides = {
  conflict: PushConflict;
  /** The user's version, as the outbox entry carried it. `null` when it was a delete. */
  mine: MutationPayloads[SyncedTable] | null;
  /** The server's version, as the push response read it back. */
  theirs: SyncedRow;
};
```

(`readCanonicalRows` returns rows per table; the join is `conflict.table` + `conflict.rowId` on
one side, `mutationId` on the other. A conflict whose sides can't both be found — theoretically
impossible, defensively `null` — falls back to today's generic message.)

### The diff

New `src/modules/sync/conflict-diff.ts`, a pure function per table: compare `mine` against
`theirs` field by field and return `{ field, label, mine, theirs }[]` for the fields that differ.
Two wrinkles worth writing into its tests:

- **The payload and the row are not the same shape.** A category payload can carry `colorHex`
  (not a column); a profile payload omits `userId` (the server's to stamp). The diff works off
  each table's `ClientColumns` — the intersection the two sides genuinely share — exactly the
  comparison `findConflicts`' sibling code in `apply-mutations` already reasons about.
- **Deletes are one-sided.** A conflicted delete renders as "deleted on this device / changed
  elsewhere" with the other side's field values shown but not diffed. There is no meaningful
  field-level diff against a row you wanted gone.

Labels and formatting live next to the diff (`format-money` for amounts, `date-fns` for dates) so
the UI stays dumb. Unit-test it like `integrity.test.ts` tests its digest: every table, the
one-field case, the delete case, the identical-except-timestamps case.

### The choice

- **"Keep mine"** is just another write: `commit([{ op: "upsert", table, row, payload }])` with
  the user's values — a fresh `mutationId`, and a `baseUpdatedAt` the store computes for free
  (it now holds the server's row, so the re-commit carries the _current_ server time as its base
  and wins cleanly under last-write-wins). Resolution rides the ordinary write path; no new
  protocol, no special case in `apply-mutations`.
- **"Keep theirs"** is a no-op: the store already holds the server's version. Dismiss.

The UI replaces `SyncConflictToasts`' single generic toast. A choice needs to survive a glance
away, so the component becomes a small resolution card — one conflict at a time, the differing
fields in two columns, two buttons — rendered from `state.conflicts` until each is decided
(`clearConflicts` already exists and becomes the "decided" path). Cap the visible queue (resolve
one, the next appears) and keep a summary line when more than a few stacked up. Base UI's Toast
is the wrong primitive for a persistent choice; the existing `Dialog` or a fixed-position card
using the `z-toast` tier fits the app's existing vocabulary. The comment that currently explains
why there is no merge UI ("a great deal of machinery for a case that barely happens") gets
rewritten to say what is now true: still no merge, no CRDT — but the realistic two-device case
gets both versions and two buttons.

### Out of scope (deliberately)

Three-way merges (neither end holds the common ancestor — `baseUpdatedAt` is a timestamp, not a
snapshot), field-level selection within one conflict ("keep my amount, their comment" — combinatorial
UI for a case that arrives at most a few times a year), and auto-resolution heuristics of any
kind.

### Verification

`conflict-diff.test.ts` covers the pure half. The integration half is a two-browser manual pass:
edit the same transaction on two devices (both offline, then bring them online one after the
other), confirm the second device shows the actual differing fields — the amount you changed,
not a shrug — and that "Keep mine" wins without a second conflict toast (its base is the server's
current row, so it cannot self-conflict). The e2e specs from the housekeeping plan's two-tab
fixture can drive one direction of this once it exists.

---

## 2. A periodic background integrity check

- [ ] `lastIntegrityCheckAt` in the IndexedDB meta store
- [ ] A weekly gate added to the existing staleness loop in `startSyncTriggers`
- [ ] Divergence surfaced, never auto-repaired

### What exists today

`verifyIntegrity` is complete and careful — held under the sync mutex, refusing to run while
writes are queued or a pull is streaming (`unsettled`), comparing count + checksum per table
against `checkIntegrity`. It runs exactly when a human clicks, on `/settings`. Nothing checks in
the background, which means a divergence that never coincides with a curious user is never
found — the original item's own framing: "if divergence ever turns out to be real rather than
theoretical." This item is how it would ever turn out to be real.

The infrastructure it plugs into already exists: `startSyncTriggers` runs a staleness interval
every 60s (only while the tab is visible) plus a `visibilitychange` handler, both funneling into
`syncIfStale` — which is a stack of exactly the right preconditions: visible, online, idle. The
weekly check is one more branch of that same shape.

### Changes

1. **Persist `lastIntegrityCheckAt` in the meta store** (`idb.ts`), alongside `cursors` /
   `colors` / `usdRates`. The meta store is the established home for exactly this kind of client
   state, and sharing it means both tabs of a browser agree on when the last check was — the
   first tab to run one stamps the time and the other sees it fresh, so two open tabs do not
   double-check. A `readMeta`/`writeMeta` pair (or just the two specific functions, matching the
   file's current style of named accessors) and the key is read in `hydrateFromLocal`'s wake.
2. **The gate**, in `startSyncTriggers`' interval and visibility handler, beside `syncIfStale`:
   visible, `isOnline`, `status === "idle"`, `isHydrated`, `outboxCount === 0`,
   `pending.length === 0`, and `Date.now() - lastIntegrityCheckAt > 7 days`. Every condition is
   already a field on the store except the last — the check is cheap to _decide_ and expensive
   only to _run_ (one round trip, four aggregates).
3. **Stamp the time only when a check actually ran** — `matched` or `diverged`, never
   `unsettled`. An unsettled attempt leaves the timestamp alone so the next interval retries it.
4. **On `diverged`: surface, do not repair.** A toast (or the sync indicator's tone) pointing at
   `/settings`, where the existing `IntegrityCheck` panel and its `resyncFromScratch` button
   live. This is the architecture doc's explicit rule — "throwing away a local copy is not
   something to do behind the user's back on the strength of one mismatched number" — and the
   item stays on the right side of it. The background check's whole job is to notice; the
   existing manual repair stays the only repair.

`verifyIntegrity` itself needs one small change: it currently returns the report to a caller who
renders it immediately; the background caller needs the timestamp written and the toast fired —
a thin `maybeCheckIntegrity()` in the engine that wraps it, not a change to the function's
contract.

### Verification

Unit-test the gate the way `isCursorStale` is tested — freeze time, assert each precondition
blocks, assert the timestamp gates a second run for the week. Manual: set the stored timestamp
back eight days in DevTools' IndexedDB viewer, open a visible tab, watch the check fire in the
network log once and not again; then hand-delete a row from the IndexedDB store — wait, and note
what the architecture doc already proved: a hand-deleted row is _re-sent by the next pull's 10s
overlap_, so it never diverges. To make the check genuinely fire `diverged`, the honest test is
a phantom row the server has never heard of — add one to IndexedDB by hand. That is the one
class of damage the pull cannot fix, which is precisely the class this item exists to catch.

---

## 3. Compress or stream the initial pull

- [ ] Measure the deployed pull's transfer size first — the result decides everything below
- [ ] Skip tombstones on a first pull (a one-predicate change, pure win)
- [ ] Palette and rates on the first page of a run only, not every page
- [ ] Payload-key compaction — only if the measurement says transport compression is absent

### What exists today

`pullChanges` sends `PULL_PAGE_SIZE = 2000` rows per table per page, full columns, JSON over the
TanStack Start RPC. Two properties of the current shape matter more than they look:

**First, a first pull ships tombstones.** `afterCursor` returns `undefined` when there is no
cursor, so the query is scope-only — every row the user owns, _including soft-deleted ones_,
full column payload and all. The client's `putRows` then does `store.delete(row.id)` for each:
bytes shipped, parsed, and discarded, for rows the device has never held. On an account with a
long delete history this is not a rounding error.

**Second, the app already streams — the "or stream" half of the item is mostly done.** The gate
opens when the reference tables land (`REFERENCE_TABLES`), and transactions arrive behind the
open app, page by page, behind the sync indicator's percentage. A cold boot does not _block_ on
the transaction backlog; it _pays bandwidth_ for it. So the item's real content is bytes, not
blocking — and that reframes the menu of options.

### Step one: measure, then decide

Before any code: against the deployed function (the dev server tells you nothing about the
CDN), capture one full-page pull with and without `Accept-Encoding`, and compare transfer size
to the JSON's byte length.

- If the responses arrive compressed — Netlify's edge compresses many response types, and the
  browser's `fetch` (which the RPC layer rides) sends `Accept-Encoding` automatically — then
  **the "gzip the payload" half of the item is already done in transit**, and hand-rolling
  compression server-side would be re-implementing the CDN. The remaining levers are the two
  payload cuts below.
- If they arrive uncompressed, the single biggest lever is transport encoding, not application
  changes — repetitive JSON keys compress extremely well — and that investigation belongs on the
  platform (headers, function response configuration) before it belongs in `sync.functions.ts`.

This is why the item is ordered first despite being "just performance": its first deliverable is
a number, and every later decision falls out of it.

### Step two: the tombstone skip (do this regardless)

One predicate in each table's pull query: when the table has **no cursor** — a first pull, or a
table this device has never completed — add `isNull(deletedAt)`. A client starting from nothing
has nothing to delete; hearing about deletions is only meaningful for rows it holds. Delta pulls
keep tombstones untouched, because that _is_ how deletions propagate. Correctness-neutral by the
cursor's own bookkeeping: the first-pull cursor lands on the last live row, rows deleted before
it are skipped forever (never held, never missed), rows deleted after it arrive as tombstones on
the next delta. `pullChangesSchema`'s shape, the client, and IndexedDB all stay as they are.

### Step three: stop repeating the per-page passengers

`colors` (the full palette) and `usdRates` (an external fetch!) ride along on **every page** of a
run. A first pull of six pages pays for the palette and the rate lookup six times. `withCounts`
already solved this exact problem the exact right way — first page of a run only. Give colors
and rates the same treatment: send them when the request is page-zero of a run (the client
already distinguishes this for `withCounts`), and let subsequent pages carry rows only. Small,
but it is free bytes on the exact path the item is about.

### The deferred option: column-key compaction

A tuple encoding — one array of column names per table, rows as arrays — would cut roughly a
third of the pre-compression payload for transactions (eleven camelCase keys per row, two
thousand rows a page). But it is a wire-format change touching `pullChanges`, the client's page
handler, and IndexedDB's row shape, and its payoff shrinks to near-nothing _if_ the measurement
in step one shows transport compression is already on. Do not build it on spec; revisit it with
the measurement in hand, and only if the number still says the cold boot is bandwidth-bound
after steps two and three.

### Out of scope (deliberately)

True response streaming (`ReadableStream` / NDJSON) — the app already renders behind the
indicator at page granularity, so streaming would complicate both ends of a protocol whose user
-visible cold boot is already non-blocking. And raising `PULL_PAGE_SIZE` — it is sized against
the 10s function cap on a slow database, not against bandwidth, and the architecture doc's
constants table is the record of that decision.

### Verification

The tombstone skip and the per-page passengers are observable in the network panel: a first pull
whose pages carry no `deletedAt`-set rows, palette and rates on page one only. Unit-test
`afterCursor`'s new branch if it grows one (it may just be the `and(...)` composition in the
handler — in which case a test of the composed predicate is not worth the indirection, and the
manual pass is the verification). Then the number from step one, re-measured after: the plan's
success metric is a delta in transferred bytes on a first pull, written back into this document
when known.

---

## 4. Retire pushed outbox entries by mutation id

- [ ] `applied_mutations` ledger table (server-only — _not_ a synced table, no checklist applies)
- [ ] Recognition + insertion inside `applyMutations`, same transaction as the apply
- [ ] Swept by the existing tombstone GC at 90 days

### What exists today, and why "it's already idempotent" is not the whole story

The wire was designed for this: every mutation already carries a `mutationId` ("identifies the
entry across a retry, and correlates it with its slot in the response"), minted once in `commit`
and immutable in the outbox. Correctness on a lost response is genuine — the push succeeded, the
response drowned, the client retries the same batch, whole-row upserts land on the same state,
`applied` comes back, the entries drop. But re-apply has two real costs, and both are worth
eliminating:

1. **The false conflict.** The retry's `baseUpdatedAt` is the _pre-first-apply_ value, but the
   server row's `updatedAt` was stamped by the first, lost apply — so `findConflicts` sees a
   mismatch and reports a conflict. The toast tells the user they overwrote a newer change when
   the "newer change" was their own write, delivered twice. (Deletes are exempt — `tombstone()`
   already skips already-tombstoned rows — this is an upsert-only failure mode, since upserts
   re-stamp `updatedAt` on every apply.)
2. **The churn.** Each retry re-stamps the row, so every other device re-downloads identical
   content on its next delta pull. Harmless, but it is bandwidth and function time spent saying
   nothing.

Item 1 builds a field-level conflict UI. Landing it before fixing the false conflict means the
new UI will occasionally render a diff where both sides are identical — the worst possible
introduction to a feature whose whole job is precision. Hence the ordering.

### The design: a recognition ledger

New table in `tables.ts` (then `pnpm db:generate` + `pnpm db:migrate`):

```
applied_mutations {
  mutationId text/uuid primary key,
  userId integer not null references users (cascade),
  appliedAt timestamptz not null default now(),
  index on (userId, appliedAt)   -- for the sweep
}
```

This is a **server-only table like `sessions` or `credentials`** — it does not replicate, does
not appear in `SYNCED_TABLES`, and the product-features plan's "Adding a synced table" checklist
does not apply to it. Say so in the table's doc comment; a future reader looking at a new table
in `tables.ts` will otherwise reach for that checklist.

Inside `applyMutations` (so every entry point gets it — including the `/api/push` route the
offline-completeness plan proposes, which is a strong argument for putting the logic _here_
rather than in `pushChanges`):

1. Per run, one `inArray` select on the batch's `mutationId`s scoped to the caller — the
   recognized set.
2. A recognized mutation is **skipped entirely** — no write, no conflict, no `touched` entry —
   but still confirmed: `applied` already returns every mutationId in the batch ("every mutation
   the server resolved"), and a recognized retry _is_ resolved, as already-done. The client drops
   the entry; nothing about the client changes.
3. The ids of newly-applied mutations are bulk-inserted in the **same transaction** as the apply
   — a crash between write and ledger is just today's behavior (safe re-apply), a crash between
   ledger and write would be a _lost_ write, so the order is apply-then-ledger within one
   transaction.

Cost: one insert per mutation. A 10k-row CSV import writes 10k ledger rows alongside its 10k
transactions — bulk, in-transaction, and swept; fine at this app's scale, and worth a sentence in
the plan rather than a mitigation.

### The retention window, and why it is low-stakes

Sweep it with the tombstone GC (`@daily`, sibling statements, same file — `netlify/functions/
tombstone-gc.ts`), at the same **90 days**. The window does not need to be exhaustive, because
the ledger is an _optimization with a safe fallback_: the outbox can outlive any window you pick
(it deliberately survives every local wipe, and the stale-cursor reset skips itself while writes
are queued), so a retry older than the sweep simply falls back to today's idempotent re-apply —
correct, just unlovely. Pruning early costs a rare cosmetic toast; that is the entire downside.
This is the property that makes the whole item safe to ship behind a flag of nothing at all.

### The alternative that was considered

**Content-equality short-circuit** — skip the write when the incoming payload matches the stored
row, instead of remembering ids. It fixes the same two costs with no new table, and it generalizes
(same content pushed twice under different ids converges too). But its failure mode is silent
data loss: a too-loose equality (money strings, nulls, the payload/row shape gap that item 1's
diff also has to bridge) skips a write that mattered, and nothing downstream would ever notice.
The ledger's failure mode is a redundant re-apply — today's behavior. Exact-and-dumb beats
clever-with-a-footgun here; if content-equality is ever wanted, item 1 will have built the
per-table comparison as a pure function on the client, and the server-side version can revisit
this decision with that work done.

### Verification

A unit-testable seam exists if you want one: extract the run-level "split into recognized and
new" decision and test it with a stubbed executor. The behavioral test is better: against the
dev database, push a batch, kill the response (a `throw` after the transaction in a scratch
branch), confirm the retry (a) confirms without a conflict in the response, (b) leaves
`updatedAt` where the first apply put it — observable in the canonical row and in the next pull
from a second client, which must _not_ re-download the row. Then `pnpm gc:tombstones` after
winding `appliedAt` back 91 days, and confirm the sweep. Typecheck and knip stay green; the
housekeeping plan's shared-constants work is what keeps the GC's table list honest when this
table is _not_ added to it (it is not a synced table — the sweep here is raw SQL in the same
standalone file, added by hand like the rest of its statements).

---

## Summary

Four items, no dependencies, the protocol's correctness untouched throughout:

- **Item 3** goes first because its first deliverable is a measurement, not a change — and
  because its one guaranteed win (first pulls stop shipping tombstones) is a predicate, not a
  project. The "or stream" half turned out to be already true at page granularity; what remains
  is bytes.
- **Item 2** schedules the check that already exists: a weekly gate inside the staleness loop
  the engine already runs, a timestamp in the meta store the engine already owns, and a hard
  line — detection surfaces, repair stays a click the user makes.
- **Item 4** makes retries recognized instead of merely safe: a ledger keyed by the
  `mutationId` the wire has carried all along, written in the apply's own transaction, swept
  with the tombstones, with a fallback (idempotent re-apply) that is simply today's behavior —
  and it removes the false conflict that would otherwise poison item 1.
- **Item 1** lands last, on now-honest inputs: the join is client-side (the push response
  already carries both sides), the diff is a pure function in the house style, and "keep mine"
  is nothing more exotic than a fresh write that last-write-wins resolves in the user's favor.

Deliberately not done anywhere in this plan: a CRDT or any merge beyond pick-a-winner (the
architecture's stance, unchanged — now with a better-informed picker), three-way merges (no
ancestor is retained, and `baseUpdatedAt` is a timestamp, not a snapshot), background
auto-repair (explicitly against the documented rule), response streaming (page granularity
already delivers its UX), and column-key compaction (deferred behind the measurement that would
justify it).

## Related Limitations

- **Conflicts are pick-a-winner, now with both versions shown.** Last-write-wins on the server
  clock at push time is still the whole policy; a device editing offline for days still
  overwrites newer server values. What changed: the overwrite is reported field by field, and
  one click re-commits the user's version as a fresh, clean write. No merge, no CRDT.
- **Integrity is checked weekly, not continuously — and repaired only by choice.** The
  background check notices and points at `/settings`; `resyncFromScratch` remains the only
  repair and still refuses to run while writes are queued. A divergence that appears and is
  repaired between weekly checks is invisible, which is the accepted trade for a check that
  costs a round trip.
- **The initial pull is linear in the row count.** Measurement aside, the boot pull still moves
  every live row once; tombstones no longer ride a first pull, and the palette and rates no
  longer ride every page, but the working-set-in-memory model keeps the cold boot proportional
  to the account (see the product-features plan's limits for where that model stops scaling).
- **Recognition of a retried push is best-effort within a 90-day window.** Older retries fall
  back to idempotent re-apply — correct, occasionally self-congratulatory in a toast. The
  outbox deliberately outlives every wipe, so no window could be exhaustive; the ledger is an
  optimization, never a correctness dependency.
- **Currency rates are USD-quoted and refreshed once a UTC day**, cached client-side; an unknown
  currency falls back to 1:1 rather than dropping the amount. Unchanged — and item 3's
  per-page-passenger fix means the rates now ride one page of a run instead of all of them,
  without changing when they refresh.
