# Product & Feature Plan

The five items from the original checklist, turned into execution plans: the current state, the
design decisions, the exact files to touch, and how to verify each one landed. Read
`docs/architecture.md` first — two of its rules govern everything here: **derivations are pure
functions, not queries** (every figure the UI shows is computed in memory from the working set),
and **a mutation is a whole row, persisted locally before it is pushed**. Four of the five items
are that model extended; the fifth is the first thing that honestly outgrows it, and says so.

Three of the five (budgets, recurring templates, attachment metadata) each add a **new synced
table**, so the full touch-list for that is written once in "Adding a synced table" below and
referenced from each item. It assumes the housekeeping plan's item 3 has landed (the shared
`synced-tables.ts` module and its invariant test) — if it hasn't, add the new table to
`SYNCED_TABLES` in `sync-types.ts` and `SWEPT_TABLES` in the GC by hand, the old way.

**One new dependency in the whole plan — `@netlify/blobs` (item 5).** Everything else is schema,
pure functions, and UI on what's installed.

| #   | Item                   | Lands as                                                    | Touches                                              | Risk        |
| --- | ---------------------- | ----------------------------------------------------------- | ---------------------------------------------------- | ----------- |
| 1   | Budgets                | new synced table + a derived-progress card on `/statistics` | the shared checklist + `modules/budgets/`            | medium      |
| 2   | Recurring transactions | new synced table + idempotent client-side materialization   | the shared checklist + `modules/recurring/`          | medium-high |
| 3   | Richer statistics      | three new pure `compute-*` functions + cards                | `modules/statistics/`, `/statistics`                 | low         |
| 4   | Import mapping step    | a mapping step in the wizard, amount/date dialect parsing   | `modules/transactions-import/`, `utils/parse-csv.ts` | low         |
| 5   | Attachments            | synced metadata + a Netlify Blobs path for bytes            | the shared checklist + a new route + a GC function   | high        |

Suggested order: **3 → 4 → 1 → 2 → 5**. Statistics and import mapping are client-only, need no
schema, and ship visible value immediately; budgets then introduces the new-synced-table
checklist on the simplest table there is; recurring reuses it and adds materialization;
attachments reuses it and adds the only new infrastructure and dependency.

---

## Adding a synced table — the shared checklist

Every new replicated table touches the same eleven places. Items 1, 2 and 5 each reference this
section instead of repeating it. Verified against how `categories` is wired today.

1. **`src/database/tables.ts`** — the table: `syncedId()` primary key, `profileId` (the scoping
   column every read and every ownership check keys on, `notNull` — the `profiles.userId`
   exception exists only for pre-auth migration rows), `...syncColumns`, and the composite
   index `(profileId, updatedAt, id)` — every read is profile-scoped and the delta pull walks
   `(updatedAt, id)` order, the same dual-purpose index `accounts` carries.
2. **Migration** — `pnpm db:generate`, then `pnpm db:migrate`. Never `drizzle-kit push`.
3. **`src/modules/sync/synced-tables.ts`** — add the name to `SYNCED_TABLES` (parents-first) and
   `SWEPT_TABLES` (children-before-parents, per the cascade rationale in that file). The
   invariant test added by the housekeeping plan goes red until both lists agree — that is it
   working.
4. **`src/modules/sync/sync-types.ts`** — `SyncedX` type (from `$inferSelect`, with any
   server-only columns omitted the way `SyncedAccount` omits `balance`), the `SyncedRows` member,
   `XPayload` (`ClientColumns<SyncedX>` minus what the server stamps, plus `profileId` via
   `Owned<T>`), and the `MutationPayloads` member.
5. **`src/modules/sync/idb.ts`** — `DATABASE_VERSION` bump to 3, and **this is the one trap in
   the checklist**: the `upgradeneeded` handler currently deletes _every_ store — including
   `outbox`, which is not a cache and whose entries exist nowhere else. Its own comment already
   says a bump "has to drain the outbox before it wipes"; the implementation must honor that by
   **skipping `OUTBOX_STORE` in the delete loop** (its shape is unchanged; keep it) and deleting
   only the replicated stores before recreating them from `SYNCED_TABLES`. The store-creation
   loop then picks the new table up for free.
6. **`src/modules/sync/useSyncStore.ts`** — the state member, `initialState()`,
   `applyRows`/`mergeRows` plumbing, `clearWorkingSet`, `replaceRows`. Mechanical, four lines
   each, in the places the other four tables already appear.
7. **`src/modules/sync/sync-engine.ts`** — decide whether the table is a _reference table_
   (small, the app cannot render without it → add to `REFERENCE_TABLES`, the gate waits for it)
   or a _streaming table_ like `transactions` (proportional to the working set → leave it out,
   rows arrive behind the open app). Budgets and recurring templates are reference tables;
   attachment metadata is not.
8. **`src/api/sync.functions.ts`** — the pull branch (select + keyset cursor, same shape as the
   other tables), the `cursors` member of `pullChangesSchema`, and the payload schema for the
   push union.
9. **`src/api/apply-mutations.server.ts`** — the apply branch: `target`/`set`/`setWhere` in the
   per-table switch, following the `categories` branch (including the ownership guard through
   `ownProfileIds`). Conflicts, tombstoning and balance recomputation are generic and need
   nothing.
10. **The domain module** — `src/modules/<domain>/<domain>-mutations.ts`, the
    `create/update/delete` trio over `commit()` and `newRow()`, shaped exactly like
    `category-mutations.ts` (including its "deleting the parent leaves the children pointing at
    it" reasoning where it applies).
11. **Green** — `pnpm typecheck`, `pnpm test:unit`, `pnpm knip` (every export consumed), and one
    round of the e2e fixtures from the housekeeping plan, which will now exercise the new
    table's store path for free.

---

## 1. Budgets

- [ ] `budgets` table + the shared checklist (reference table)
- [ ] `compute-budget-progress.ts` (+ unit test) — pure, like every other derivation
- [ ] `BudgetsCard` on `/statistics`, create/edit/delete in a Dialog
- [ ] A `toCurrency` helper beside `toUsd` in `utils/money.ts`

### What exists today

No budget concept anywhere. The two halves it needs are both already standing: `categories`
(with `CategoryRow` carrying `colorHex` for tinting), and the statistics page's month machinery —
`computeAvailableSpendingMonths` picks the months, the `month` search param is shared by the
trend and the breakdown, and `computeCategorySpending` already computes exactly the number a
budget is compared against (a month's per-category EXPENSE total in USD, local month bounds,
`toUsd` at the account's rate, no-account rows skipped).

### Design

- **Schema** (`budgets`): `profileId` notNull, `categoryId` notNull FK to categories, and — the
  one real decision — **`currencyCode` + `monthlyLimit money`**, not a bare number. A budget is
  a personal commitment made in a currency the user thinks in ("500 EUR for groceries"), not a
  USD statistic; the statistics page speaks USD because it compares across accounts, but a
  limit is set once, in one currency. Conversion needs one small helper: `toCurrency(amount,
from, to, usdRates)` beside `toUsd` (`usdRates` are units per 1 USD, so it is a divide then a
  multiply — same fallback-to-1:1 rule, same file). The cheaper cut — USD-only budgets, matching
  the statistics axis — is a legitimate fallback if the picker proves fussy; write the choice in
  the card's props.
- **One budget per (profile, category).** No unique constraint enforces it (UUIDs, offline
  creation), same as nothing enforces a category's name being unique — the UI offers the
  un-budgeted categories only, and a duplicate that slips through renders as two rows, not as a
  corrupt state.
- **The derivation**: `computeBudgetProgress({ transactions, accounts, budgets, usdRates, month,
categories })` → per budget: spent (the same loop as `computeCategorySpending`, converted to
  the budget's currency instead of USD), `monthlyLimit`, `share` (0–1, what sizes the bar,
  unrounded like `computeCategorySpending.share`), and `isOver`. Budgets whose category has
  been tombstoned are skipped — the store no longer holds the category, which is the app's
  single notion of gone.
- **Placement**: `/statistics`, a `BudgetsCard` beside `CategoryBreakdownCard`, sharing the same
  month selector — a budget's whole meaning is "this month against a limit", so it belongs on
  the page that already owns "this month". Management (create with category + currency +
  limit, edit, delete) lives in a Dialog inside the card, listing the profile's categories; the
  import wizard's `generateUniqueHexColors` pattern is the precedent for a form that creates
  rows across tables in one commit.
- **Partial-sync honesty**: while `pending` holds `transactions`, progress is a climbing figure,
  exactly like the balances and every other card on that page — the sync indicator already says
  so, and the card inherits that for free by living on the same page. Nothing new to build; just
  do not "fix" it per-card.

### Verification

The derivation is where the correctness lives: unit-test `compute-budget-progress` the way
`compute-category-spending.test.ts` does (month bounds, multi-currency accounts, over-budget
boundary, deleted category, no-account rows). The rest is the shared checklist's green list plus
a manual pass: create a budget, watch the bar fill against the breakdown card's number for the
same category — the two must agree, because they are the same loop.

---

## 2. Recurring transactions

- [ ] `recurring` table + the shared checklist (reference table)
- [ ] `materialize-recurring.ts` (+ unit test) — a pure function of templates, held ids and `now`
- [ ] A `deterministic-uuid.ts` util — same occurrence, two devices, same row id
- [ ] Materialization called from boot and after each pull; `RecurringCard` on `/settings`

### What exists today

Nothing. This is the one item that is a _behavior_, not just data: rows have to come into
existence on a schedule. The two brute-force answers are both wrong here — a server cron
materializing rows works, but it is a second writer outside the sync model, and "the user
creates each occurrence" is not a feature. The design below is neither: **materialization is a
client-side derivation with side effects, made idempotent by deterministic ids.**

### Design

- **Schema** (`recurring`): the transaction's own columns (`type`, `amount` money,
  `necessityLevel`, `comment`, `accountId` notNull, `categoryId` nullable), plus the schedule —
  **`intervalCount integer` + `intervalUnit` enum `DAY|WEEK|MONTH|YEAR` + `anchorDate
timestamptz`** — plus `active boolean` and the shared columns. Deliberately not RRULE: the
  four intervals cover rent, salary, subscriptions and insurance; RRULE's edge cases (BYSETPOS,
  COUNT, UNTIL) are a dependency or a parser, and the guardrail is to ask before adding either.
  `date-fns`' `addMonths` clamps month-ends (Jan 31 → Feb 28) consistently on every device,
  which is the one interval behavior that has to be identical everywhere.
- **The core idea — deterministic instance ids.** An occurrence's row id is derived, not minted:
  16 bytes from `crypto.subtle.digest("SHA-256", "recurring:<templateId>:<occurrenceIndex>")`,
  formatted as a UUID (the util sits beside `uuid-v7.ts`, whose comment explains why ids are
  client-minted at all). Two devices offline for a week, both materializing Thursday's rent,
  produce the _same id and the same content_ — and the whole-row upsert that everything else
  already leans on makes that a no-op rather than a duplicate. This is the existing idempotency
  property, reused as the concurrency scheme.
- **Materialization is lazy and past-only**: `materializeRecurring(templates, heldTransactionIds,
now)` returns the occurrences with `dueDate <= now` whose ids are not already held, as an
  array of `LocalChange[]` handed to `commit()`. Crucially, **`createdAt` is the due date, not
  the materialization moment** — a device opened after a month away backfills that month's rent
  with its real date, so balances and statistics are right no matter when materialization ran.
  A new template's `anchorDate` is its first due date, so nothing backfills by construction.
  Call it from `bootSync` (after `hydrateFromLocal`, before `syncNow` — occurrences join the
  same push) and at the end of `pullUntilCaughtUp` (another device's new template materializes
  locally without a reload).
- **The one wrinkle to verify at implementation**: `commit()` computes `baseUpdatedAt` from the
  store, so a device that already holds an occurrence carries its base and no conflict is
  reported. A device that materializes an occurrence the server already has (it pulled before
  the template arrived? unlikely but possible mid-sync) pushes `baseUpdatedAt: null` against an
  existing row — check how `findConflicts` treats that in `apply-mutations.server.ts`. If it
  reports a conflict, the toast is a false alarm (the content is identical); if that turns out
  to be reachable in practice, have the materializer prefer the held row's base. Note it, decide
  it when the code is open — do not guess.
- **Editing a template changes the future, not the past**: materialized occurrences are ordinary
  transactions and stay; `updateRecurring` is an upsert of the template row. Deactivation
  (`active: false`) stops future materialization; deletion tombstones the template and likewise
  leaves the transactions alone — the `category-mutations.ts` comment about children pointing at
  a deleted parent is the exact precedent.
- **UI**: a "Recurring" section on `/settings` (it is standing configuration, not this month's
  picture): list with cadence, amount, account, next due date (a pure `nextDueDate(template,
now)` beside the materializer, both tested), edit/deactivate/delete, create via Dialog with
  the transaction form's account/category pickers.

### Verification

The materializer is a pure function and gets the fullest unit tests in this plan: due-date
boundaries (exactly now, one ms after), clamped month-ends, already-held occurrences producing
no changes, `active: false` producing none, and — the property the design stands on — **two
calls with the same inputs producing byte-identical changes** (same deterministic ids). Manual
pass: create a daily template yesterday, watch two occurrences appear with yesterday's and
today's dates; open a second tab, confirm no duplicates anywhere.

---

## 3. Richer statistics

- [ ] `compute-monthly-income-expense.ts` (+ test) and an `IncomeExpenseCard`
- [ ] `compute-category-trend.ts` (+ test) — months × categories, stacked bars
- [ ] `compute-net-worth.ts` (+ test) — balances per currency, one USD total, on `/accounts`

### What exists today

The statistics page is three pure functions and five cards, all over the same in-memory array
("what used to be 216 lines of SQL and three round trips"). `computeMonthlySpendingTrend` and
`computeCategorySpending` already establish every convention a new one needs: local month bounds
via `startOfMonth`/`addMonths`, `toUsd` at the _account's_ rate (rows without an account cannot
be placed on a USD axis and are skipped), magnitudes for EXPENSE (stored negative), unrounded
shares, `toSorted` largest-first. `toAccountsWithBalance` already computes per-account balances
from `initialBalance` + transactions. All three new functions are these patterns recombined —
no schema, no sync, no store changes.

### The three derivations

- **Income vs. expense by month** — `computeMonthlyIncomeExpense({ transactions, accounts,
usdRates, months: 12 })`: one point per month, `incomeUsd` (INCOME, magnitudes) and
  `expenseUsd` (EXPENSE, magnitudes), same bounds/currency/skip rules as the trend. The chart is
  a grouped bar pair per month (recharts is already a dependency — `SpendingTrendCard` is the
  styling precedent); savings rate (`(income − expense) / income`, guarded against zero) is a
  free line on the same axis and the one number that makes the pair worth a card.
- **Category breakdown over time** — `computeCategoryTrend({ …, months: 12 })`: the months ×
  categories matrix, each cell a USD total under the same rules as `computeCategorySpending`,
  rendered as stacked bars, one stack per month. Two practical decisions to write into the card:
  **top N categories + "Other"** (a 30-category stack is unreadable at 320px — N ≈ 6, "Other"
  colored with the neutral `graphite` token), and month labels rendered from the same
  `yyyy-MM` strings the month selector already uses. The matrix comes out of one pass over
  transactions into a `Map<month, Map<categoryId, total>>` — the same accumulator shape as the
  existing functions, one level deeper.
- **Per-currency net worth** — `computeNetWorth(accounts, transactions, usdRates)`: per
  `currencyCode`, the sum of `toAccountsWithBalance` balances (this one does _not_ convert
  inside the loop — the whole point is the native figure), plus one converted USD total across
  currencies via `toUsd` for the single headline number. Group by currency, sum per group,
  format with the existing money formatting. Placement: **`/accounts`**, beside
  `computeBalanceTotals`' current/savings/archived cards — that page already owns "what am I
  worth", and net worth per currency is that question answered honestly for multi-currency
  users, where the USD-only totals quietly hide the composition.

### Verification

Three new test files beside the existing two, same fixtures-and-edge-cases style: month
boundaries, multi-currency accounts, zero-income months, the empty working set, and (for net
worth) an account with no transactions. Manual pass: cross-check one month of the income/expense
card against the trend card's final cumulative point and the breakdown card's total — three
functions, one number, by construction.

---

## 4. Import mapping step and statement dialects

- [ ] `guess-mapping.ts` (+ test) — headers → best-guess field mapping, with aliases
- [ ] A `MappingStep` in the wizard, with a live preview of the first data row
- [ ] Amount and date dialect parsing, extracted into testable helpers (+ tests)

### What exists today

The wizard is two steps (`upload` → `processing`) and the mapping is rigid: `IMPORT_HEADERS`'
nine names must appear verbatim (`getMissingHeaders` rejects otherwise), `csvToImportRows` reads
by exact header name, amounts go through `parseAmount`'s single `replace(",", ".")`, and dates
go through `new Date(...)` and the browser's goodwill. `parseCsv` itself is already good —
RFC-4180 quoting, BOM, CRLF, and delimiter auto-detection over `,`/`;`/tab. `buildImportPlan`
is a pure function over `ImportRow[]`, which is the seam this whole item exploits: **mapping
becomes a step that produces `ImportRow[]` from any column layout, and everything downstream is
untouched.**

### Design

- **The mapping state**: `mapping: Record<ImportField, number | null>` — file column index per
  import field — added to `useTransactionsImport` alongside `rows`. An unmapped optional field
  reads as `""`, which flows through the existing per-row validation unchanged (a row with no
  mapped amounts fails as "Both income and outcome are empty or zero" — correct, and already
  worded).
- **Auto-guess**: `guessMapping(headers)` scores each header against a small alias table per
  field (case-insensitive, trimmed): `date|created|booking_date|time` → `createdDate`;
  `amount_out|debit|spent|outcome|withdrawal` → `outcome`; `amount_in|credit|income|deposit` →
  `income`; `account|from|source|account_from` → `outcomeAccountName`; and so on for the nine.
  Exact match wins, aliases fill the rest, everything else starts unmapped. A one-time
  hand-written alias table beats a fuzzy-scoring dependency; the user corrects the rest.
- **`MappingStep`** between upload and processing: one `Select` per import field (the repo's
  Base UI `Select`, the transaction form's currency/account pickers as the pattern), a required
  set enforced before **Import** enables (`createdDate` + one of the amount fields + its
  account), and **the first data row rendered live under the mapping** — "here is what row 1
  will become" is worth more than any label. `UploadStep` stops rejecting missing headers; a
  file that parses as CSV always proceeds to mapping, which is where a genuinely unusable file
  now shows itself.
- **Amount dialects** — the real blocker for European statements today: `parseAmount`'s
  `replace(",", ".")` turns `"1.234,56"` into `NaN` and the row fails. Extract a
  `parseAmountCell(raw, dialect)` into the import module with two dialects — `1,234.56` and
  `1.234,56` — auto-detected per file (scan the amount columns; a cell matching
  `/^\d{1,3}([.,]\d{3})+[.,]\d{2}$/ names its own dialect by its last separator) with a manual
override on the mapping step next to the preview. Detection is a pure function over the
parsed columns → unit-tested; `buildImportPlan`gains a`dialect` field in its context and
  stays pure.
- **Date dialects** — same shape: a `parseDateCell(raw, format)` trying a candidate list
  (`yyyy-MM-dd`, `dd/MM/yyyy`, `MM/dd/yyyy`, `dd.MM.yyyy`, ISO) via date-fns' `parse` with a
  strict reference date, auto-guessed (the first parseable format across the column wins) and
  overridable on the mapping step. `dd/MM` vs `MM/dd` stays genuinely ambiguous — detection
  picks `dd/MM` when any cell's first number exceeds 12, else defaults and says so in the UI.
  Ambiguity is disclosed, never silently resolved.
- **Out of scope**: OFX / QIF / Camt.053. Real work (XML parsing, per-bank dialects) for a
  payoff that is mostly "the same rows, a different wrapper" — and CSV export is universal in
  banking UIs. The mapping step plus dialects is what unblocks real statements; revisit binary
  formats only if a specific bank makes it a real requirement rather than a hypothetical.

### Verification

`guess-mapping.test.ts`, `parse-amount`/`parse-date` helper tests (dialect detection incl. the
ambiguous cases, `1.234,56`, thousands-with-decimal-cents, empty = zero), and the existing
`build-import-plan.test.ts` extended for the dialect field. Manual pass with
`samples/transactions.csv` and — the point of the item — a real bank export renamed and
re-ordered, mapped by hand in under a minute.

---

## 5. Attachments (receipts)

- [ ] `attachments` synced metadata table + the shared checklist (streaming table, not reference)
- [ ] `@netlify/blobs` (**the one new dependency — approval first**), store `attachments`
- [ ] Upload: client-side downscale → `createAttachment` server function → blob write → normal
      `commit()` of the metadata row
- [ ] Download: `src/routes/api/attachments/$attachmentId.ts`, ownership-checked, immutable-cached
- [ ] `netlify/functions/attachment-gc.ts` — the blob sweep, sibling of `tombstone-gc.ts`
- [ ] Paperclip in the transaction form; viewer Dialog loading bytes on open

### What exists today

Nothing, and the reason is structural rather than absent-minded: the sync model replicates
**rows** — whole rows, JSON, 2000 to a page against a 10s function cap. A receipt is a JPEG
orders of magnitude bigger than the transaction it belongs to; putting bytes in that stream
would make the first pull a download and the outbox a lie. So the item splits in two, exactly as
the original checklist predicted: **metadata is a synced table, bytes are a separate store the
sync engine never sees.**

### Design

- **Schema** (`attachments`): `transactionId` uuid FK, `filename`, `mimeType`, `sizeBytes
integer`, `blobKey text`, `profileId` notNull (denormalized from the transaction, the same
  reasoning `transactions.profileId` documents — the ownership check in `apply-mutations` keys
  on it), shared columns. It is a streaming table like `transactions` — proportional to the
  working set, _not_ in `REFERENCE_TABLES`, arriving behind the open app. One deliberate
  asymmetry with every other synced table: **rows are created only through a server function**
  (below), because the blob has to exist before the metadata that points at it does.
- **Storage — Netlify Blobs.** The app already deploys as Netlify functions (`netlify.toml`,
  `@netlify/vite-plugin-tanstack-start`); Blobs needs no new account, secret, or bucket policy,
  and its client is one package — `@netlify/blobs` (the one dependency this whole plan asks to
  add). Documented fallbacks, both heavier: S3/R2 presigned URLs (a second provider, SigV4
  signing, per-env secrets) or postgres `bytea` (bytes through the query path and the 10s
  cap — strictly worse here). Blobs is the pragmatic fit; it is still an approval, per the
  guardrails.
- **Upload path, v1 — relayed and downscaled.** Receipts from a phone camera are 3–8MB; a
  client-side canvas downscale (bitmap → ~1600px JPEG, quality ~0.8) lands them at 200–400KB,
  which makes the whole rest of the design simple: a single `createAttachment` server function
  (multipart, `authMiddleware` + profile middleware, Zod on the fields, MIME allowlist
  `image/jpeg|png|webp` + `application/pdf`, ~4MB hard cap — comfortably under the function
  body limit) writes the blob and returns its key; the client then `commit()`s the metadata row
  like any other write, and sync carries it to every device. **`blobKey` is the SHA-256 of the
  bytes** — content-addressed, so the same receipt attached twice is stored once and the
  download route can send `Cache-Control: immutable`. The upload is the one mutation in the app
  that needs a connection (the blob cannot be queued in the outbox); v1 accepts that honestly —
  the UI disables the paperclip while offline. Queuing bytes in IndexedDB for later upload is a
  documented follow-up if it ever matters, not hidden scope.
- **Download path**: `src/routes/api/attachments/$attachmentId.ts` (run
  `pnpm generate-routes`), a GET route handler — the repo's `api-routes` pattern, and the same
  shape the offline-completeness plan uses for its push route. Resolve the session, check
  ownership through the row's `profileId` (a single indexed query), fetch the blob, stream it
  with its content type. Every device gets bytes on demand; nothing large rides a pull.
- **Deletion and GC**: deleting an attachment is an ordinary tombstone mutation on the metadata
  row. The blob is cleaned by `netlify/functions/attachment-gc.ts`, a deliberate sibling of
  `tombstone-gc.ts` — standalone, raw, scheduled `@daily`, runnable by hand
  (`pnpm gc:attachments`): list the store's keys, delete any with no live metadata row on
  _this_ deployment's database. Eager deletion inside `apply-mutations` was considered and
  rejected — it would couple the atomic DB transaction to a network store; the sweep-after
  pattern is already the house style for exactly this trade.
- **UI**: a paperclip in the transaction form's Dialog (`transaction-form/` module), a clip
  marker on `TransactionsList` rows, and a viewer Dialog whose `<img src>` is the download route
  — lazy by construction, bytes fetched when the dialog opens, never when the list renders.

### Verification

Unit tests for the pure parts only: the MIME/size allowlist and the key-derivation (same bytes →
same key). The rest is manual and DevTools-driven: attach from one browser (watch the function
log, the blob store, and the outbox counter), see the clip on another device after sync, open it
offline (bytes are cached immutable), delete it, run `pnpm gc:attachments`, confirm the blob is
gone. Then the destructive edge: delete the _transaction_ — its attachments' metadata rows stay
(tombstoned transactions do not cascade, by design) and the GC sweeps their blobs on the next
run; write that expected behavior into the GC's comment so it reads as a decision.

---

## Summary

Five items, one dependency, and the architecture's two rules intact — reads still come from
memory, writes still land locally first:

- **Statistics** (item 3) goes first: three new pure functions in the established
  `compute-*` style, no schema, no sync, immediate value — and net worth finally answers for
  multi-currency users on the page that owes them the answer.
- **Import mapping** (item 4) next, client-only: the mapping step exploits `buildImportPlan`'s
  existing purity — mapping produces `ImportRow[]`, the plan is untouched — and the amount/date
  dialects are what actually unblock real bank exports.
- **Budgets** (item 1) introduces the new-synced-table checklist on the simplest table there
  is: a limit per category per profile, progress derived client-side on the statistics page
  that already computes the same number.
- **Recurring** (item 2) reuses the checklist and adds the plan's one genuine mechanism:
  deterministic instance ids turn the existing whole-row idempotency into a concurrency scheme,
  so any device can materialize any occurrence and none can duplicate it.
- **Attachments** (item 5) reuses the checklist for metadata and then leaves the model, as
  advertised: bytes in Netlify Blobs, content-addressed, uploaded through one downsizing
  function, downloaded through one ownership-checked route, swept by a GC in the house style.

Deliberately not done anywhere in this plan: RRULE-style recurrence (four intervals cover the
real cases; a parser is a dependency), OFX/QIF ingestion (CSV export is universal; revisit on a
real requirement), offline attachment upload (bytes cannot ride the outbox; the paperclip is
honest about it), budget rollovers/periods other than monthly (the statistics page's whole
calendar is monthly), and any server-side materialization of recurring rows (it would be a
second writer outside the sync model — the one thing this codebase must not grow).

## Related Limitations

- **The working set has to fit in memory.** Roughly 2MB per 10,000 transactions, and the boot
  pull is linear in the row count. Fine for personal use, wrong for an account with millions of
  rows. Unchanged — and attachments, the one thing that would have broken it outright, keeps its
  bytes out of the working set entirely; only its metadata replicates.
- **Balances are derived client-side from every transaction held.** Correct by construction,
  but a partial first sync shows figures that are still climbing — the indicator says so.
  Budget progress and every new statistic inherit this honestly by living on the same pages
  under the same indicator; nothing per-card is bolted on.
- **Recurring occurrences exist once a device has opened the app after they fall due.** A
  template due monthly materializes on whichever device wakes first, with the due date as its
  `createdAt` — so history is right whenever it happens, but a month where no device opened has
  no rows until one does. Deterministic ids mean however many devices wake, the occurrence is
  created exactly once.
- **Attachments need a connection to create.** The blob must exist server-side before the
  metadata that points at it, so upload is the one mutation that cannot be queued offline; the
  paperclip is disabled rather than silently lossy. Deleted transactions leave orphaned blobs
  for up to a day of GC, the same grace every tombstone already enjoys.
- **Currency rates are USD-quoted and refreshed once a UTC day**, cached client-side; an unknown
  currency falls back to 1:1 rather than dropping the amount. Budgets inherit the fallback the
  same way every USD figure does — a budget in a currency the rates feed has never heard of
  converts 1:1, which is the totals rule applied consistently.
