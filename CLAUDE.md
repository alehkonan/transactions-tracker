# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev              # vite dev on http://localhost:5454 (host exposed on LAN)
pnpm build            # production build (client + SSR) into dist/
pnpm preview          # preview the production build (port 5454)
pnpm test:unit        # vitest run (no test files exist yet)
pnpm test:e2e         # playwright test — e2e/ (starts the dev server if not already running)
pnpm typecheck        # tsc --noEmit
pnpm lint             # oxlint  (lint:fix to autofix)
pnpm knip             # knip — unused files, exports and dependencies (runs pre-push)
pnpm format           # oxfmt
pnpm generate-routes  # tsr generate — regenerate src/routeTree.gen.ts
pnpm db:push          # drizzle-kit push — sync schema straight to the dev DB
pnpm db:generate      # drizzle-kit generate — write a migration for the schema diff
pnpm db:migrate       # drizzle-kit migrate — apply pending migrations
```

Run a single test once tests exist: `pnpm vitest run path/to/file.test.ts` (or `-t "name"` to filter by test name).

Linting/formatting use **oxlint** and **oxfmt** (not ESLint/Prettier). Lefthook runs `format` + `lint:fix` on staged files pre-commit, and `typecheck` + `test:unit` + `knip` pre-push.

## Stack

TanStack Start (React 19, SSR shell) · TanStack Router (file-based) · TanStack Table (`DataTable`) · Drizzle ORM + postgres-js (PostgreSQL) · IndexedDB (hand-rolled wrapper, no library) · Zustand (the replicated working set, plus flow state such as the CSV import) · Zod v4 · Tailwind CSS v4 · Vite 8 · TypeScript 6. Package manager is **pnpm**.

Path alias: `~/*` → `./src/*` (defined in `tsconfig.json`). Use it for all intra-`src` imports.

## Architecture

**The app is offline-first: every read is served from memory, and PostgreSQL is a sync backend.** The whole working set (profiles, accounts, categories, transactions — a few MB) is replicated into IndexedDB and held in a Zustand store; there are no route loaders and no data-fetching layer. See `docs/offline-first-sync.md` for the plan and which phases have landed.

- **Read path: `pullChanges` → IndexedDB → Zustand store → pure derivations.** `src/api/sync.functions.ts` is the only read endpoint: a keyset-paginated delta pull, scoped to the caller's user, that sends tombstones as rows with `deletedAt` set. `src/modules/sync/` holds the IndexedDB wrapper (`idb.ts`), the store and its boot/pull orchestration (`useSyncStore.ts`), the loading gate (`SyncGate.tsx`) and the shared row/cursor types (`sync-types.ts`).
  - **The pull cursor's `updatedAt` is an opaque timestamp literal, never a `Date`.** Postgres keeps microseconds and `Date` only milliseconds, and a strict cursor rounded down re-sends the page it just sent, forever.
  - **Derivations are pure functions over the store, not queries** — `compute-balances.ts`, `to-transaction-rows.ts`, `filter-transactions.ts`, `compute-daily-averages.ts` and friends, each unit-tested. `accounts.balance` is never replicated: clients derive it from `initialBalance` plus the transactions they hold, so it cannot disagree with them.
  - **Each domain exposes its slice as a hook** (`useAccounts`, `useCategories`, `useTransactionRows`) that selects raw store arrays and memoizes the derivation. Never map or filter _inside_ a Zustand selector — a fresh array on every render is a new snapshot, and the component never settles.
  - **Nothing renders until the store is hydrated**, so route components never run during SSR (`SyncGate` is what SSR emits). Client-only cookie reads and locale-dependent formatting are therefore safe from hydration mismatches.
  - **Hydration is progressive.** The gate opens as soon as the reference tables (`profiles`, `accounts`, `categories` — one page each) are complete, and transactions stream in behind the rendered app; `pullChanges` reports what is still `pending` per table, plus (on the first page of a run only) the `transactionBacklog` that `SyncProgress` turns into a percentage, so partial transaction-derived figures never look final. The `Navbar` is hidden until `isHydrated` — while the gate is up, every destination is the same loading screen. Relatedly, `defaultPendingMs` in `router.tsx` must stay above 0: navigations no longer fetch data, so a 0ms threshold only flashes a spinner while a code chunk loads.
- **Write path is still server functions** (`src/api/*.functions.ts`, `createServerFn`, composed with `.middleware([loggerMiddleware, authMiddleware, profileMiddleware])`), pending the Phase 3 outbox. **Every mutation call site must `await syncNow()` afterwards**, not `router.invalidate()` — there is no loader left to invalidate, so the change only reaches the UI through a pull.
- **Deletes are tombstones, never `DELETE`.** A row that simply vanishes is invisible to a delta pull and lives on every client forever, so the delete mutations set `deletedAt`+`updatedAt`, and soft-deleting an account explicitly tombstones its transactions (the FK cascade only fires for real deletes). Correspondingly, **every server-side read must filter `deleted_at is null`** — see `transactionsSum`, `reconcileAccountBalances`, `ownership.server.ts` and the import's account/category lookups.
- **A server function that a middleware rejects resolves with a raw `Response`; it does not throw.** The 401 from `authMiddleware` arrives at the caller as a value, so any client code that must react to it has to check (`useSyncStore`'s `isPullResult`).
- **`src/database/get-db.server.ts`** exposes `getDb()`, a lazily-initialized Drizzle singleton. It has **no top-level side effects** so the TanStack Start compiler can tree-shake the postgres driver out of the client bundle — never create the DB connection at module scope; always inside a server-fn handler via `getDb()`. Files with `.server.ts` are server-only.
- **Auth is passkeys (WebAuthn) only**, via `@simplewebauthn`. `src/api/auth.functions.ts` runs both ceremonies; `webauthn.server.ts` holds the RP config and the single-use challenge store. `sessionMiddleware` injects `context.user` (nullable), `authMiddleware` requires it and 401s otherwise. Deployments must set `AUTH_SECRET` (see below), `AUTH_RP_ID` and `AUTH_ORIGIN`; the latter two fall back to the request URL locally, and WebAuthn's secure-context rule means dev only works over `localhost`, not the LAN host Vite also serves on.
- **The auth path costs zero queries in the common case**, because the database is the slow part. `session.server.ts` mints two cookies, both `httpOnly` / `SameSite=Lax`: a **stateless signed access cookie** (1h) carrying `{sessionId, userId, username, expiresAt}`, HMAC-SHA256'd with `AUTH_SECRET` by `signed-cookie.server.ts` — nothing secret may go in one, since signing proves origin but does not hide the payload — and an **opaque refresh token** (24h), the only thing still stored SHA-256-hashed in `sessions`. `resolveSession()` verifies the access cookie with no query and only touches the database once an hour to re-issue it; the 24h refresh deadline does not slide. The cost is that revoking a session (a single `DELETE`) takes effect when the access cookie next expires.
- **Route guards read cookies, never the network.** `__root.tsx`'s `beforeLoad` is synchronous and checks two non-`httpOnly` hint cookies — `session_hint` (`session-hint.ts`, `{exp, username}`; the username is what lets `/settings` name the signed-in user offline) and `profile_hint` (`profile-cookie.ts`, the selected profile id) — via the isomorphic `readCookie` (`utils/read-cookie.ts`), so navigation costs no RPC and the app still opens offline. **The hints are forgeable and carry no authority**: they only decide what renders, and every server function re-proves the caller. Each hint has an `httpOnly` counterpart that is the real thing, and the two must be written and cleared together (`setSelectedProfileCookie` / `clearSelectedProfileCookies`) — a hint that outlives its counterpart strands the user on a page that resolves to nothing.
- **Record ids from the client are never trusted on their own.** `profileMiddleware` proves the caller owns the _profile_; a handler that also accepts an `id` must scope the statement to that profile too (`and(eq(table.id, id), eq(table.profileId, context.profileId))`). Transactions carry a denormalized `profileId`, so they scope directly on it — every write has to set it to the owning account's profile, since nothing in the database enforces that the two agree. For ids that arrive in a request _body_ (e.g. the `accountId` a transaction is filed against), use `assertAccountsInProfile` / `assertCategoriesInProfile` from `src/api/ownership.server.ts`, which throw 403.
- **`src/database/schema.ts`** is the single source of truth for tables/enums. Migrations are generated into `src/database/migrations/` by drizzle-kit; `drizzle.config.ts` and `get-db.server.ts` both read the discrete `POSTGRES_USER`/`PASSWORD`/`HOST`/`PORT`/`DB` variables (not a `DATABASE_URL`), loaded from `.env` locally and from the real environment in deployments.
- **Pick either `db:push` or `db:generate` + `db:migrate` for a given database, and stick to it.** `push` applies the schema diff without recording anything in `drizzle.__drizzle_migrations`, so a database that was pushed to looks unmigrated to `db:migrate`, which then replays old migrations and fails on the first already-applied statement — with the error swallowed by drizzle-kit, leaving only a bare exit code 1.
- **Input validation lives next to the server function**, as a Zod schema passed to `.validator(...)` in the same `src/api/*.functions.ts` file (there is no shared schema module).

### Directory layout

- `src/routes/` — file-based routes; `__root.tsx` is the SSR shell. `routeTree.gen.ts` is **generated — never edit by hand**.
- `src/api/` — server functions (`*.functions.ts`) and middleware (`*.middleware.ts`), created with `createServerFn`/`createMiddleware`. `sync.functions.ts` is the read path; everything else is a mutation or auth.
- `src/database/` — Drizzle schema (`schema.ts`), generated migrations (`migrations/`), and the `getDb()` singleton (`get-db.server.ts`).
- `src/modules/<domain>/` — self-contained domain UI/logic, grouped by feature rather than file type (e.g. `transactions/transactions-table-columns.tsx`, `transactions-import/useTransactionsImport.ts`). A sub-feature that outgrows its parent domain folder gets promoted to its own sibling module (e.g. `transaction-form/` split out of `transactions/`).
- `src/components/` — shared presentational primitives (`Button`, `Card`, `Dialog`, `Table`, `DataTable`, `Title`, …) and app chrome (`Navbar`, `NavLink`, `NotFoundPage`, `Loader`).
- `src/utils/` — generic, framework-agnostic helpers with no server/DB dependency (e.g. `parse-csv.ts`, `money.ts` — decimal-string arithmetic over integer cents, used on both sides).

## Conventions

- **Filenames are kebab-case, with two exceptions: React components are PascalCase, and custom `use*` hooks are camelCase.** A component file is named `<ComponentName>.tsx` and holds exactly that one component; a hook file is named after the hook (`useTransactionForm.ts`, `usePasskeyAuth.ts`). Everything else — helpers, server functions, middleware, stores, types, tests — is kebab-case regardless of what its exports are called (`format-money.ts` exports `formatMoney`, `read-cookie.ts` exports `readCookie`, `get-db.server.ts` exports `getDb`). Generated and framework-reserved files are exempt: `routeTree.gen.ts`, `src/routes/__root.tsx`, and `src/database/migrations/`.
- **Styling uses semantic design tokens, not raw Tailwind colors.** Tokens are defined in `src/styles.css` under `@theme` (`--color-accent`, `--color-surface`, `--color-text`, `--color-border`, `-muted`/`-hover`/`-active` variants) and consumed as classes like `bg-accent`, `text-surface`, `border-border`. Compose class strings with `twMerge` (when merging incoming `className`) or `twJoin` (static) from `tailwind-merge`.
- **z-index is a global scale, not ad-hoc numbers.** Tiers (`z-stack`, `z-navbar`, `z-dropdown`, `z-dialog-backdrop`, `z-dialog`, `z-toast`) are defined in `src/styles.css` under `@theme` (`--z-index-*`). Never use a raw `z-10`/`z-50` or an inline `zIndex` outside an `isolate`d local stacking context — see the `z-index-system` skill before adding one.
- Dark mode uses `dark:` variants directly in markup (no separate theme file yet).
- Navbar links are typed against `FileRouteTypes["fullPaths"]` from the generated route tree — after adding a route, run `pnpm generate-routes` so paths type-check.

## Notes

- `AGENTS.md` is stale — it describes the original blank scaffold (claims no DB and a `#/*` alias). Trust this file and the code instead.
- Before a substantial library-specific/architectural change, the TanStack Start best-practices skill is available locally; load it for SSR/server-fn/routing guidance.
