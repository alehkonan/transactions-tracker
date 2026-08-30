# Transactions tracker

A personal finance tracker for multi-currency, multi-account bookkeeping: accounts and balances,
categorized transactions, spending statistics, and CSV import/export.

It is **offline-first**. The whole working set is replicated to the browser, every read is served
from memory and every write lands locally first; PostgreSQL is a sync backend rather than a database
a warm tab keeps working with no connection at all — reads, writes, filters,
statistics and imports — and the queued changes push themselves when the network comes back.

**Conflict handling is intentionally simple:** when two devices edit the same existing row, the last
write accepted by the server replaces the whole row; there is no field-level merge. New transactions
use client-generated UUIDs, so concurrent new transactions do not conflict and are both added.

**Read [`docs/architecture.md`](docs/architecture.md) for the applied solution** — the pull/push
protocol, the sync engine, tombstones and retention, integrity checking, and the auth path. Known
production and design constraints are tracked in [`docs/limitations.md`](docs/limitations.md).

Database access is server-only and the current request handlers enforce ownership before syncing or
mutating data. A staged PostgreSQL Row-Level Security rollout is documented in the
[`docs/plans/`](docs/plans/) directory; RLS is not enabled by the default setup until its data,
transaction-context, and database-role prerequisites are complete.

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
| `POSTGRES_CA_CERT_BASE64`                                                             | Base64-encoded PostgreSQL CA PEM; required in deployments.    |
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

See [`docs/architecture.md`](docs/architecture.md) for the directory layout and where things belong.

The design tokens and the z-index scale live in `src/styles.css`.

## Roadmap

Current plans live in [`docs/plans/`](docs/plans/). That directory is the single source of truth for
planned work and implementation details.
