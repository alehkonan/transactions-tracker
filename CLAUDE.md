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

TanStack Start (React 19, full-stack SSR) · TanStack Router (file-based) · TanStack Table (`DataTable`) · Drizzle ORM + postgres-js (PostgreSQL) · Zustand (client state, e.g. the CSV import flow) · Zod v4 · Tailwind CSS v4 · Vite 8 · TypeScript 6. Package manager is **pnpm**.

Path alias: `~/*` → `./src/*` (defined in `tsconfig.json`). Use it for all intra-`src` imports.

## Architecture

**Data flow is: route `loader` → server function → Drizzle → PostgreSQL**, all rendered via SSR. There is no client-side data-fetching layer (no TanStack Query).

- **Server functions** live in `src/api/*.functions.ts`, created with `createServerFn`. GET handlers read; POST handlers mutate. Every server function is composed with `.middleware([loggerMiddleware, authMiddleware])` from `src/api/*.middleware.ts`. Routes call the functions directly from their `loader`.
- **`src/database/get-db.server.ts`** exposes `getDb()`, a lazily-initialized Drizzle singleton. It has **no top-level side effects** so the TanStack Start compiler can tree-shake the postgres driver out of the client bundle — never create the DB connection at module scope; always inside a server-fn handler via `getDb()`. Files with `.server.ts` are server-only.
- **Auth is passkeys (WebAuthn) only**, via `@simplewebauthn`. `src/api/auth.functions.ts` runs both ceremonies; `webauthn.server.ts` holds the RP config and the single-use challenge store. `sessionMiddleware` injects `context.user` (nullable), `authMiddleware` requires it and 401s otherwise. Deployments must set `AUTH_SECRET` (see below), `AUTH_RP_ID` and `AUTH_ORIGIN`; the latter two fall back to the request URL locally, and WebAuthn's secure-context rule means dev only works over `localhost`, not the LAN host Vite also serves on.
- **The auth path costs zero queries in the common case**, because the database is the slow part. `session.server.ts` mints two cookies, both `httpOnly` / `SameSite=Lax`: a **stateless signed access cookie** (1h) carrying `{sessionId, userId, username, expiresAt}`, HMAC-SHA256'd with `AUTH_SECRET` by `signed-cookie.server.ts` — nothing secret may go in one, since signing proves origin but does not hide the payload — and an **opaque refresh token** (24h), the only thing still stored SHA-256-hashed in `sessions`. `resolveSession()` verifies the access cookie with no query and only touches the database once an hour to re-issue it; the 24h refresh deadline does not slide. The cost is that revoking a session (a single `DELETE`) takes effect when the access cookie next expires.
- **Route guards read cookies, never the network.** `__root.tsx`'s `beforeLoad` is synchronous and checks two non-`httpOnly` hint cookies — `session_hint` (`session-hint.ts`, an expiry timestamp) and `profile_hint` (`profile-cookie.ts`, the selected profile id) — via the isomorphic `readCookie` (`utils/read-cookie.ts`), so navigation costs no RPC and the app still opens offline. **The hints are forgeable and carry no authority**: they only decide what renders, and every server function re-proves the caller. Each hint has an `httpOnly` counterpart that is the real thing, and the two must be written and cleared together (`setSelectedProfileCookie` / `clearSelectedProfileCookies`) — a hint that outlives its counterpart strands the user on a page that resolves to nothing.
- **Record ids from the client are never trusted on their own.** `profileMiddleware` proves the caller owns the _profile_; a handler that also accepts an `id` must scope the statement to that profile too (`and(eq(table.id, id), eq(table.profileId, context.profileId))`). Transactions have no profile of their own — they inherit one through their account, so they scope via the `transactionsInProfile()` subquery in `transaction.functions.ts`. For ids that arrive in a request _body_ (e.g. the `accountId` a transaction is filed against), use `assertAccountsInProfile` / `assertCategoriesInProfile` from `src/api/ownership.server.ts`, which throw 403.
- **`src/database/schema.ts`** is the single source of truth for tables/enums. Migrations are generated into `src/database/migrations/` by drizzle-kit; `drizzle.config.ts` and `get-db.server.ts` both read the discrete `POSTGRES_USER`/`PASSWORD`/`HOST`/`PORT`/`DB` variables (not a `DATABASE_URL`), loaded from `.env` locally and from the real environment in deployments.
- **Pick either `db:push` or `db:generate` + `db:migrate` for a given database, and stick to it.** `push` applies the schema diff without recording anything in `drizzle.__drizzle_migrations`, so a database that was pushed to looks unmigrated to `db:migrate`, which then replays old migrations and fails on the first already-applied statement — with the error swallowed by drizzle-kit, leaving only a bare exit code 1.
- There is currently **no input-validation layer** on server functions — the previous `src/utils/*.schema.ts` Zod schemas (and the mutations that used them, e.g. `createAccount`/`deleteAccount`) were removed pending rework. `zod` is still a dependency; when a mutation needs `.validator(zodSchema)` input validation again, add the schema next to the server function in `src/api/`.

### Directory layout

- `src/routes/` — file-based routes; `__root.tsx` is the SSR shell. `routeTree.gen.ts` is **generated — never edit by hand**.
- `src/api/` — server functions (`*.functions.ts`) and middleware (`*.middleware.ts`), created with `createServerFn`/`createMiddleware`.
- `src/database/` — Drizzle schema (`schema.ts`), generated migrations (`migrations/`), and the `getDb()` singleton (`get-db.server.ts`).
- `src/modules/<domain>/` — self-contained domain UI/logic, grouped by feature rather than file type (e.g. `transactions/transactions-table-columns.tsx`, `transactions-import/useTransactionsImport.ts`). A sub-feature that outgrows its parent domain folder gets promoted to its own sibling module (e.g. `transaction-form/` split out of `transactions/`).
- `src/components/` — shared presentational primitives (`Button`, `Card`, `Dialog`, `Table`, `DataTable`, `Title`, …) and app chrome (`Navbar`, `NavLink`, `NotFoundPage`, `Loader`).
- `src/utils/` — generic, framework-agnostic helpers with no server/DB dependency (e.g. `parse-csv.ts`).

## Conventions

- **Filenames are kebab-case, with two exceptions: React components are PascalCase, and custom `use*` hooks are camelCase.** A component file is named `<ComponentName>.tsx` and holds exactly that one component; a hook file is named after the hook (`useTransactionForm.ts`, `usePasskeyAuth.ts`). Everything else — helpers, server functions, middleware, stores, types, tests — is kebab-case regardless of what its exports are called (`format-money.ts` exports `formatMoney`, `read-cookie.ts` exports `readCookie`, `get-db.server.ts` exports `getDb`). Generated and framework-reserved files are exempt: `routeTree.gen.ts`, `src/routes/__root.tsx`, and `src/database/migrations/`.
- **Styling uses semantic design tokens, not raw Tailwind colors.** Tokens are defined in `src/styles.css` under `@theme` (`--color-accent`, `--color-surface`, `--color-text`, `--color-border`, `-muted`/`-hover`/`-active` variants) and consumed as classes like `bg-accent`, `text-surface`, `border-border`. Compose class strings with `twMerge` (when merging incoming `className`) or `twJoin` (static) from `tailwind-merge`.
- **z-index is a global scale, not ad-hoc numbers.** Tiers (`z-stack`, `z-navbar`, `z-dropdown`, `z-dialog-backdrop`, `z-dialog`, `z-toast`) are defined in `src/styles.css` under `@theme` (`--z-index-*`). Never use a raw `z-10`/`z-50` or an inline `zIndex` outside an `isolate`d local stacking context — see the `z-index-system` skill before adding one.
- Dark mode uses `dark:` variants directly in markup (no separate theme file yet).
- Navbar links are typed against `FileRouteTypes["fullPaths"]` from the generated route tree — after adding a route, run `pnpm generate-routes` so paths type-check.

## Notes

- `AGENTS.md` is stale — it describes the original blank scaffold (claims no DB and a `#/*` alias). Trust this file and the code instead.
- Before a substantial library-specific/architectural change, the TanStack Start best-practices skill is available locally; load it for SSR/server-fn/routing guidance.
