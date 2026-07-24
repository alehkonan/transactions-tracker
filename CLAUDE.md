# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev              # vite dev on http://localhost:5454 (host exposed on LAN)
pnpm build            # production build (client + SSR) into dist/
pnpm preview          # preview the production build (port 5454)
pnpm test             # vitest run (no test files exist yet)
pnpm typecheck        # tsc --noEmit
pnpm lint             # oxlint  (lint:fix to autofix)
pnpm format           # oxfmt
pnpm generate-routes  # tsr generate — regenerate src/routeTree.gen.ts
pnpm db:push-dev      # drizzle-kit push — sync schema to the dev DB
```

Run a single test once tests exist: `pnpm vitest run path/to/file.test.ts` (or `-t "name"` to filter by test name).

Linting/formatting use **oxlint** and **oxfmt** (not ESLint/Prettier). Lefthook runs `format` + `lint:fix` on staged files pre-commit and `typecheck` pre-push.

## Stack

TanStack Start (React 19, full-stack SSR) · TanStack Router (file-based) · Drizzle ORM + postgres-js (PostgreSQL) · Zod v4 · Tailwind CSS v4 · Vite 8 · TypeScript 6. Package manager is **pnpm**.

Path alias: `~/*` → `./src/*` (defined in `tsconfig.json`). Use it for all intra-`src` imports.

## Architecture

**Data flow is: route `loader` → server function → Drizzle → PostgreSQL**, all rendered via SSR. There is no client-side data-fetching layer (no TanStack Query).

- **Server functions** live in `src/utils/*.functions.ts`, created with `createServerFn`. GET handlers read; POST handlers mutate and use `.validator(zodSchema)` for input. Routes call them directly from their `loader`.
- **`src/lib/db.server.ts`** exposes `getDb()`, a lazily-initialized Drizzle singleton. It has **no top-level side effects** so the TanStack Start compiler can tree-shake the postgres driver out of the client bundle — never create the DB connection at module scope; always inside a server-fn handler via `getDb()`. Files with `.server.ts` are server-only.
- **`src/drizzle/schema.ts`** is the single source of truth for tables/enums. Migrations are generated into `src/drizzle/migrations/` by drizzle-kit; `drizzle.config.ts` reads `DATABASE_URL` from `.env.local`.
- **Zod schemas** in `src/utils/*.schema.ts` mirror the Drizzle tables and are the validation layer for server-fn inputs. They compose (e.g. `AccountSchema` → `CurrencyCodeSchema`; insert payloads use `.omit({ id: true })`). Keep these in sync with `schema.ts` by hand.

### Directory layout

- `src/routes/` — file-based routes; `__root.tsx` is the SSR shell. `routeTree.gen.ts` is **generated — never edit by hand**.
- `src/features/<feature>/` — self-contained feature UI (e.g. `add-transaction/`, `transactions-import/`).
- `src/components/` — shared presentational primitives (`Button`, `Card`, `Dialog`, `Title`, …).
- `src/layout/` — app chrome (`Body`, `Header`, `Navbar`).
- `src/pages/` — non-route page components (e.g. `NotFound`).
- `src/utils/` — server functions (`*.functions.ts`) and Zod schemas (`*.schema.ts`).

## Conventions

- **Single-component files are named `<ComponentName>.tsx` in PascalCase.**
- **Styling uses semantic design tokens, not raw Tailwind colors.** Tokens are defined in `src/styles.css` under `@theme` (`--color-accent`, `--color-surface`, `--color-text`, `--color-border`, `-muted`/`-hover`/`-active` variants) and consumed as classes like `bg-accent`, `text-surface`, `border-border`. Compose class strings with `twMerge` (when merging incoming `className`) or `twJoin` (static) from `tailwind-merge`.
- Dark mode uses `dark:` variants directly in markup (no separate theme file yet).
- Navbar links are typed against `FileRouteTypes["fullPaths"]` from the generated route tree — after adding a route, run `pnpm generate-routes` so paths type-check.

## Notes

- `AGENTS.md` is stale — it describes the original blank scaffold (claims no DB and a `#/*` alias). Trust this file and the code instead.
- Before a substantial library-specific/architectural change, the TanStack Start best-practices skill is available locally; load it for SSR/server-fn/routing guidance.
