# transactions-tracker

## Read first

- `docs/architecture.md` is the source of truth for the offline-first sync
  architecture. Follow it when changing data flow, sync, authentication, or
  storage behavior.
- Do not read or commit `.env*` files. Use `.env.example` for variable names.

## Stack and commands

- TanStack Start, React 19, TypeScript, Tailwind CSS v4, Drizzle/PostgreSQL,
  IndexedDB, Zustand, Zod, and pnpm.
- Lefthook runs formatting and `lint:fix` on commit, then typecheck, unit tests,
  and `knip` before push. Do not run them redundantly unless the user requests
  it or they are needed to diagnose a specific change.
- Run `pnpm generate-routes` after adding or renaming routes. Never edit
  `src/routeTree.gen.ts` by hand.

## Guardrails

- Preserve the offline-first flow: reads come from IndexedDB/Zustand, mutations
  are persisted locally first and synchronized through `src/api/sync.functions.ts`.
- Keep database access server-only. Do not create database connections at module
  scope; use `src/database/get-db.server.ts`.
- Keep generated migrations and the Drizzle schema in sync. Use
  `db:generate` followed by `db:migrate`; do not use `drizzle-kit push`.
- Use semantic Tailwind tokens from `src/styles.css`, not raw color classes.
- Do not alter unrelated user changes. Ask before adding dependencies or running
  destructive database or Git commands.
