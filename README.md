# Transactions tracker

A personal finance tracker for multi-currency, multi-account bookkeeping: accounts and balances,
categorized transactions, spending statistics, and CSV import/export.

It is **offline-first**. The whole working set is replicated to the browser, every read is served
from memory and every write lands locally first; PostgreSQL is a sync backend rather than a database
the UI talks to. A warm tab keeps working with no connection at all — reads, writes, filters,
statistics and imports — and the queued changes push themselves when the network comes back.

**Read [`docs/architecture.md`](docs/architecture.md) for the applied solution** — the pull/push
protocol, the sync engine, tombstones and retention, integrity checking, and the auth path.

## Features

- **Profiles** — separate books under one account, each with its own accounts, categories and
  transactions.
- **Accounts** — current and saving, active or archived, in USD/EUR/GEL/BYN/KZT/RUB/TRY/UZS. Balances
  are derived, never stored on the client.
- **Transactions** — income, expense and transfer, with categories and a necessity level (low →
  essential), filterable by account and date range.
- **Statistics** — daily averages, monthly spending trend, and a money-runway estimate, all computed
  in the browser.
- **CSV import/export** — the import matches accounts, categories and colors against the working set
  in memory, so it is instant and works offline.
- **Passkey sign-in** — WebAuthn only, no passwords.

## Getting started

```bash
pnpm install
$EDITOR .env             # see the variables below — compose.yaml reads them too
docker compose up -d     # local PostgreSQL 18
pnpm db:migrate          # apply generated migrations
pnpm dev                 # http://localhost:5454
```

**Sign-in only works over `localhost`.** WebAuthn requires a secure context, so the LAN host Vite
also serves on cannot complete a passkey ceremony.

### Environment

Read from `.env` locally and from the real environment in deployments.

| Variable                                                                              | Notes                                                         |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB` | Discrete variables, not a `DATABASE_URL`.                     |
| `AUTH_SECRET`                                                                         | HMAC key for the signed access and profile cookies. Required. |
| `AUTH_RP_ID`, `AUTH_ORIGIN`                                                           | WebAuthn relying party. Fall back to the request URL locally. |

## Commands

```bash
pnpm dev              # vite dev on http://localhost:5454 (host exposed on LAN)
pnpm build            # production build (client + SSR) into dist/
pnpm preview          # preview the production build
pnpm test:unit        # vitest run
pnpm test:e2e         # playwright test
pnpm typecheck        # tsc --noEmit
pnpm lint             # oxlint  (lint:fix to autofix)
pnpm knip             # unused files, exports and dependencies
pnpm format           # oxfmt
pnpm generate-routes  # tsr generate — regenerate src/routeTree.gen.ts
pnpm db:generate      # write a migration for the schema diff
pnpm db:migrate       # apply pending migrations
pnpm gc:tombstones    # run the tombstone sweep by hand
```

Lefthook runs `format` + `lint:fix` on staged files pre-commit, and `typecheck` + `test:unit` +
`knip` pre-push.

## Stack

TanStack Start (React 19, SSR shell) · TanStack Router (file-based) · TanStack Table · Drizzle ORM +
postgres-js (PostgreSQL) · IndexedDB (hand-rolled wrapper, no library) · Zustand · Zod v4 · Base UI ·
Tailwind CSS v4 · Recharts · Vite 8 · TypeScript 6 · oxlint/oxfmt · Vitest + Playwright. Package
manager is **pnpm**; deployment target is Netlify.

Path alias: `~/*` → `./src/*`.

```
src/
├── api/          # server functions (*.functions.ts), middleware, server-only helpers (*.server.ts)
├── components/   # shared presentational primitives and app chrome
├── database/     # Drizzle schema, migrations, and the getDb() singleton
├── modules/      # self-contained domain UI/logic, grouped by feature (incl. sync/)
├── routes/       # file-based routes; __root.tsx is the SSR shell
├── utils/        # generic helpers with no server/DB dependency
└── styles.css    # Tailwind theme tokens and the z-index scale
```

See `CLAUDE.md` for conventions (file naming, design tokens, the z-index scale) and
[`docs/architecture.md`](docs/architecture.md) for how the sync works.

---

## Limitations

Known and deliberate, in rough order of how likely they are to bite.

- **No offline cold start.** A warm tab is fully offline-capable, but a full page load with no
  connection has nothing to serve the document and the route chunks, however complete the local
  database is. There is no service worker yet.
- **Conflicts are reported, not resolved.** Last-write-wins on the server clock at push time. A
  device editing offline for days will overwrite newer server values; `baseUpdatedAt` detects the
  clobber and raises a toast, and that is all it does. There is no merge UI and no CRDT.
- **A device offline for more than 60 days pays for a full re-pull.** Tombstones are swept at 90
  days, so a local copy whose oldest cursor is past `STALE_CURSOR_AFTER_DAYS` is dropped rather than
  resumed from — otherwise it would keep deleted rows forever with nothing looking wrong.
- **IndexedDB eviction can lose queued writes.** Safari evicts storage for non-installed sites after
  ~7 days of no use, and the outbox goes with it. Mitigated by a short push debounce and a
  `beforeunload` warning, not solved.
- **Session revocation is up to an hour late.** The access cookie is stateless and verified without a
  query; deleting the session row takes effect when it next expires.
- **The working set has to fit in memory.** Roughly 2MB per 10,000 transactions, and the boot pull is
  linear in the row count. Fine for personal use, wrong for an account with millions of rows.
- **Balances are derived client-side from every transaction held.** Correct by construction, but it
  does mean a partial first sync shows figures that are still climbing — the indicator says so.
- **The tombstone GC's table list is maintained by hand.** It is deliberately standalone (raw SQL, no
  Drizzle), so a new synced table has to be added to it as well as to `SYNCED_TABLES`.
- **Integrity checking is manual.** `/settings` runs it on request; nothing checks in the background,
  and the only repair is a full re-download.
- **No e2e coverage yet.** Playwright is configured and `pnpm test:e2e` exists, but there are no
  specs; the 61 unit tests cover the derivations, the import planner and the integrity digest.
- **Passkeys only, single credential flow.** No password fallback and no recovery path — losing every
  registered authenticator means losing access.
- **Currency rates are USD-quoted and refreshed once a UTC day**, cached client-side; an unknown
  currency falls back to 1:1 rather than dropping the amount.

## TODO

Roughly in priority order.

**Offline completeness**

- [ ] **PWA service worker** — precache the document and route chunks so a cold start works with no
      connection, plus a web app manifest so the app can be installed (which also gets it out of
      Safari's 7-day eviction bucket).
- [ ] **`navigator.storage.persist()`** on first successful sync, for the same reason.
- [ ] **Background Sync** for the outbox, so queued writes leave even if the tab is closed.

**Sync robustness**

- [ ] **Field-level conflict reporting** — the toast currently says a row was clobbered, not which
      fields differed. Showing both versions with a "keep mine / keep theirs" choice would cover the
      realistic two-device case without going near a CRDT.
- [ ] **A periodic background integrity check** (weekly, on an idle visible tab) if divergence ever
      turns out to be real rather than theoretical.
- [ ] **Compress or stream the initial pull.** 2000-row pages against a slow database is the floor
      right now; a gzipped payload or a narrower column set on the first run would cut the cold boot.
- [ ] **Retire pushed outbox entries by mutation id server-side**, so a push that succeeds but whose
      response is lost does not depend on idempotent re-apply for correctness.

**Product**

- [ ] **Budgets** — per-category monthly limits, with the progress derived client-side like
      everything else.
- [ ] **Recurring transactions** — templates that materialise on a schedule.
- [ ] **Richer statistics** — category breakdown over time, income vs. expense by month, per-currency
      net worth.
- [ ] **Bank statement formats beyond the current CSV shape**, and a mapping step in the import
      wizard rather than fixed column names.
- [ ] **Attachments on transactions** (receipts), which is the first thing here that will not fit in
      the "replicate everything" model and needs a separate blob path.

**Housekeeping**

- [ ] **E2E specs** for the paths unit tests cannot reach: the boot gate, a two-tab sync, and an
      offline write that pushes on reconnect.
- [ ] **Multi-device session management** on `/settings` — list and revoke sessions and passkeys.
- [ ] **Move the tombstone GC's table list into a shared constant** the Netlify function can import
      without pulling in the app's server graph.
- [ ] **A dark-mode theme file.** `dark:` variants are inline in markup today.
