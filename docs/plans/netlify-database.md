# Switch to Netlify Database with an empty dataset

Status: application changes implemented; hosted rollout pending, 2026-10-27. The user explicitly chose a fresh start.

Implemented in the working tree: pinned `@netlify/database` 2.0.1, shared lazy connection resolution,
verified hosted TLS, preserved Drizzle migrations, Node 24 builds, fresh IndexedDB/broadcast namespace,
protocol v4, dataset-bound signed cookies, and updated regression coverage. Local development keeps
Docker PostgreSQL; the adapter's automatic local Netlify database is disabled.

Local PostgreSQL uses separate `POSTGRES_*` credentials without URL encoding. The hosted connection
is selected by `NETLIFY=true`, excluding `NETLIFY_DEV=true`; local configuration ignores
`NETLIFY_DB_URL`. No local Netlify database is required.

Validation during implementation, before the final environment-selection adjustment: `pnpm build` passed, including anonymous-shell prerendering. The generated service worker
uses the new database namespace and schema v4; connection/TLS implementation markers are absent from
the generated client JavaScript. `git diff --check` passed. Commit and push validation is handled by
Lefthook; see the pull request for final check outcomes.

Hosted provisioning, migration replay, secret rotation, publication, passkey/browser smoke checks, and
latency measurements remain pending. The Netlify connector confirms `crackertracker` belongs to the
user's Free team. No hosted database or deployment changes were made during local implementation.

## Scope and decisions

Use Netlify Database on the credit-based Free plan. Exhausting the free allowance and temporarily losing service is acceptable; capacity planning, paid upgrades, and quota optimization are outside scope. Free-plan availability is documented in [Netlify pricing](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/).

Start with an empty database. Do not transfer financial records, users, passwords, passkeys, sessions, mutation receipts, or old browser outboxes. The user will register again and create new profiles. No dump, restore, dual writes, import tooling, or data reconciliation is needed.

Keep the existing architecture: IndexedDB/Zustand serve reads, mutations persist locally first, and the existing sync endpoints synchronize with PostgreSQL. Keep Drizzle, `postgres`, and the `drizzle-orm/postgres-js` adapter. Netlify supports standard PostgreSQL drivers; using its native Drizzle adapter is unnecessary for this change. Add `@netlify/database` for branch-aware connection discovery after checking the selected version against the existing runtime. [Netlify tooling](https://docs.netlify.com/build/data-and-storage/netlify-database/tooling/)

Keep `src/database/migrations/`, its metadata, and the `db:generate` → `db:migrate` workflow. Netlify explicitly supports external migration runners; do not also create an automatically detected `netlify/database/migrations/` directory. This follows the repository instructions rather than the bundled skill's preference for Netlify-managed migrations. [Manual migrations](https://docs.netlify.com/build/data-and-storage/netlify-database/migrations/#manual-migrations)

## Why this should help

[Current limitations](../limitations.md) record Netlify Functions in Ohio and Supabase in Tokyo, adding distance to every database round trip. Netlify's database provisioning defaults to the functions region. Verify the actual placement before switching. Reduced network distance is a plausible improvement, not a measured speed guarantee. [Database API](https://docs.netlify.com/build/data-and-storage/netlify-database/api/)

The recorded cold pull also spent substantial time before application logging began. Database migration may improve SQL phases without eliminating platform cold starts. Preserve current timeouts and batching until measurements justify separate tuning.

## 1. Prepare the empty backend

1. Confirm that the existing Netlify team uses the credit-based Free plan and the project has Database available. Do not upgrade to a paid plan.
2. Provision Netlify Database for the existing site, confirming the database and functions regions. Establish an isolated Deploy Preview before changing production routing.
3. Check the target PostgreSQL version, supported connection endpoint, verified TLS, and database URL availability during builds and function execution. Verify interactive transactions and transaction-local timeout settings with the actual runtime.
4. Apply the existing migrations `0000` through `0019` to a clean preview database using `db:migrate`. Re-read the migration journal at implementation time in case the branch has advanced. The existing SQL includes sphere/allocation functions, triggers, and deferred guards; generating a new schema from table definitions alone would omit these objects.
5. Keep only normal schema/default behavior. Do not seed copied accounts or financial history. Verify that first registration and first profile creation initialize the required records correctly.

Preview database changes remain isolated from production; a preview is not a data-promotion mechanism. Production will receive its own clean schema initialization. [Database branching](https://docs.netlify.com/build/data-and-storage/netlify-database/)

## 2. Change the server connection boundary

| File                                                       | Planned change                                                                                                                                              |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`, `pnpm-lock.yaml`                           | Add the reviewed `@netlify/database` version; retain existing ORM/driver versions unless compatibility evidence requires otherwise.                         |
| `src/database/get-db.server.ts`                            | Resolve the Netlify branch connection lazily inside the server-only boundary. Preserve `getDb()`, `Executor`, and the existing transaction API.             |
| `netlify/functions/tombstone-gc.ts`                        | Resolve the same environment-specific target for the standalone scheduled function; remove its deployed dependency on Supabase credentials and CA.          |
| `drizzle.config.ts`                                        | Use the explicit environment target for migrations, preserve schema/output paths and the existing migration ledger.                                         |
| `netlify.toml`                                             | Make preview migrations target their preview branch; ensure production migrations complete before publishing code. Keep migration failure release-blocking. |
| `.env.example`                                             | Document local database variables and Netlify connection discovery without including credentials.                                                           |
| `README.md`, `docs/architecture.md`, `docs/limitations.md` | Update provider, connection, migration, and fresh-start instructions after implementation.                                                                  |

Use `getConnectionString()` or the platform-provided `NETLIFY_DB_URL` in deployed contexts; never pin production credentials into preview configuration. A missing Netlify connection must fail clearly rather than silently fall back to Supabase. Retain local `POSTGRES_*` support for the existing Docker PostgreSQL workflow. Do not add another Vite integration just for this migration. [Connection API](https://docs.netlify.com/build/data-and-storage/netlify-database/api/)

Replace the mandatory Supabase CA with the target's verified TLS configuration. Keep certificate verification enabled. Initially retain `max: 1`, `prepare: false`, connection/idle deadlines, and database-side transaction deadlines. Confirm that the actual hosted endpoint provides appropriate pooling; `max: 1` is only per function instance.

For migrations, retain one runner and one ledger. Preview execution during the build is supported. Production needs explicit pre-publication execution because custom runners have no arbitrary publish-time hook. The existing production build step can remain that gate if it receives the correct target; a later build failure does not undo an already-applied migration. Keep future schema changes backward compatible. [Migration lifecycle](https://docs.netlify.com/build/data-and-storage/netlify-database/migrations/)

## 3. Make the fresh start include browser state

An empty server alone is insufficient: this application retains financial records and pending writes in IndexedDB. New serial user IDs can also overlap with old IDs. Prevent an old client from repopulating the new database.

1. Change `INDEXED_DB_NAME` in `src/modules/sync/indexed-db-contract.ts` to a new dataset namespace, for example `transactions-tracker-netlify-v1`. Keep schema version 4 unless the local schema itself changes. The new app must create an unbound, empty replica and must never copy the old outbox or owner descriptor into it.
2. Increment `SYNC_PROTOCOL_VERSION` from 3 to 4 in `src/modules/sync/sync-types.ts`. Both RPC sync and `/api/push` must reject the old protocol before domain writes or receipt claims. This is a deliberate compatibility break for the fresh dataset.
3. Rotate production `AUTH_SECRET` at cutover and clear stale auth/profile hints when establishing the new workspace. Empty session tables alone do not invalidate the existing stateless signed access cookies.
4. Give the sync broadcast channel a dataset-specific name so old tabs cannot announce changes into the new replica. Retain the shared browser operation lock because cookies are still shared across tabs on the same origin.
5. Ship the new PWA build through the existing update mechanism. Close old tabs/installed-app windows and reopen to activate it. The recovery page can refresh the worker/cache if necessary; it deliberately does not clear IndexedDB. New code must use the new namespace regardless.
6. Leave the old IndexedDB namespace unused initially; removing it is optional cleanup after the new app works. Do not depend on deletion succeeding while an old tab still holds it open. No new recovery or migration UI is required.

Accounts and passkeys must be registered again. Existing passkeys stored by the browser have no credential records in the new database. Keep the production domain and WebAuthn RP/origin configuration; verify new passkey registration on that domain. A random preview URL does not prove production passkey compatibility.

## 4. Verify in preview, then switch production

Preview release gates:

- All existing SQL migrations apply from empty and a second run is a no-op; the ledger matches the repository.
- Registration, password sign-in, profile creation, account/category creation, and session renewal work on the new backend.
- An expense, linked transfer, sphere attribution, and reallocation retain atomicity and the expected balances.
- Offline edits survive reload and synchronize once when connectivity returns; replaying an accepted mutation does not duplicate it.
- An old cached client with pending mutations cannot write to the new backend, even when an old and new numeric user ID match. A new client starts empty.
- Preview runtime, migration commands, and maintenance resolve the intended database; preview writes do not reach production.
- A simulated unavailable database preserves local reads/writes and queued changes, consistent with the accepted free-tier outage behavior.

Implementation should extend the existing auth, sync-protocol, replica, and PWA coverage only where these new boundaries need evidence. Leave formatting, lint, typecheck, unit tests, and knip to Lefthook as instructed; do not run them manually without an explicit request. Hosted smoke checks and relevant browser flows remain release evidence, including an installed-PWA check.

Production sequence:

1. Prepare the same empty schema on the production Netlify database. Keep runtime traffic on the old deployment until the replacement build is ready.
2. Publish the reviewed build with the new database target, protocol, local namespace, and rotated auth secret together.
3. Reopen the app, register a fresh account, create a profile, then verify password/passkey authentication and one complete offline-to-online sync cycle.
4. Verify the scheduled tombstone function targets Netlify, then remove Supabase connection variables from deployed contexts. Keep local Docker variables where needed.
5. Retire old source access after the new backend works. Deleting the Supabase project is separate optional cleanup, not necessary for this switch.

No final export, write-freeze for data preservation, or synchronization of old outboxes is required. Old deployments must not retain a path to write to the new backend.

## 5. Measure and finish

Use the existing request/phase logging to compare warm and cold `pull`, `push`, and session renewal, plus total invocation duration. Compare equivalent synthetic workloads on both providers where possible: an empty new database versus a populated old database is not a fair latency comparison. Report timings as observations, without promising a multiplier.

If rollout fails before new use, restore the previous deployment with its matching old database/auth configuration, or keep the fresh backend unavailable while fixing the release. After new use, prefer a forward fix; reverting to Supabase does not carry new Netlify records back. The user accepted discarding the old dataset, not automatically discarding future records. Do not mix a deployment's protocol, local namespace, and database generation during rollback.

Completion means: the Free Netlify database is the deployed sync backend; the app starts with a clean account/workspace; old browser state cannot enter it; existing offline behavior works; and the actual connection/phase timings have been recorded. Quota exhaustion does not block acceptance.

Supporting documentation: [provider research](../research/netlify-database-provider-research.md). Account-specific settings and hosted compatibility remain execution-time checks; this plan does not claim they have already passed.
