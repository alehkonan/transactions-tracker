# transactions-tracker

## Communication

- Respond as briefly as possible. Include only the result, essential caveats, and validation; omit filler, routine narration, and repeated tool output.
- Run exactly one executable command per `terminal` invocation. Send sequential commands in separate calls rather than chaining them with `&&`, `;`, pipes, or command substitution, so allowlisted operations run immediately and permission prompts describe one auditable action whose risks can be understood before allowlisting.
- Do not read or commit `.env*` files. Use `.env.example` for variable names.

## Stack and commands

- TanStack Start, React 19, TypeScript, Tailwind CSS v4, Drizzle/PostgreSQL,
  IndexedDB, Zustand, Zod, and pnpm.
- Leave validation to Lefthook: it runs formatting and `lint:fix` on commit,
  then typecheck, unit tests, and `knip` before push. Do not run these checks
  from the agent session unless the user explicitly requests a specific check.

- Run `pnpm generate-routes` after adding or renaming routes. Never edit
  `src/routeTree.gen.ts` by hand.
- Assume the development server is available at `http://localhost:5454/` and
  check that URL first. Only suggest starting the server when it is unavailable.

## Guardrails

- Preserve the offline-first flow: reads come from IndexedDB/Zustand, mutations
  are persisted locally first and synchronized through `src/api/sync.functions.ts`.
- Keep database access server-only. Do not create database connections at module
  scope; use `src/database/get-db.server.ts`.
- Keep generated migrations and the Drizzle schema in sync. Use
  `db:generate` followed by `db:migrate`; do not use `drizzle-kit push`.
- Use semantic Tailwind tokens from `src/styles.css`, not raw color classes.
- Default to native HTML controls, especially for phone-first inputs and pickers.
  Keep React wrappers thin: styling, labels, validation, and form integration only.

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues and are managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Use a single-context layout with root `CONTEXT.md` and `docs/adr/`. See `docs/agents/domain.md`.
