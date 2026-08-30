# Netlify–Supabase Database Resilience Plan

The production `502` incident was mitigated on 2026-08-29 by deploying pull/push phase logs, database-side transaction deadlines, controlled retryable `503` responses, and a bounded optional currency-rate request. The offline-first flow remains unchanged.

Current constraints and the resolved incident context are documented in [`docs/limitations.md`](../limitations.md). This file contains only remaining work. Implement each step only when production measurements justify it; the issue is currently considered solved.

## How to use this plan

This is a conditional resilience roadmap, not a checklist to implement all at once. First finish deployment verification in steps 1–2: apply migration `0008_nosy_mordo.sql`, deploy and test the TLS and receipt changes, and only then enable Supabase SSL enforcement. Monitor production phase logs for several days after that rollout.

Do not implement steps 3–6 merely because they are listed. The successful production baseline completed the application pull in about 5.2 seconds, including a 3.1-second database transaction and 1,208 transactions, while most of the invocation duration occurred before `sync.request.started`. Push/pull query or payload changes would not address that pre-dispatch delay and could increase database work. Choose an optimization from steps 3–6 only when production measurements identify its corresponding bottleneck; remove this plan once all required rollout work is verified and the remaining conditional items are either implemented or explicitly rejected as unnecessary.

Status labels describe the repository at the time this plan was last updated. **Implemented** means the code exists locally; it does not imply that a migration was applied, a deployment succeeded, or production behavior was verified.

## 1. Verify and monitor the deployed configuration

**Status: partially implemented.** Verified TLS configuration is implemented for runtime, Drizzle Kit, and tombstone maintenance. Production deployment verification, Supabase SSL enforcement, and sustained monitoring are still pending.

1. Deploy and verify the configured TLS clients for the transaction pooler on port `6543`:
   - keep `POSTGRES_CA_CERT_BASE64` available to runtime, Drizzle Kit, and tombstone maintenance;
   - verify sign-in, pull, push, a migration connection, and tombstone maintenance in preview;
   - then enable **Database Settings → SSL Configuration → Enforce SSL on incoming connections** in Supabase, which briefly reboots the database;
   - record no credentials or certificate contents in logs or documentation.
2. Monitor production logs for:
   - Netlify invocations approaching 30 seconds and the pre-dispatch gap before `sync.request.started`;
   - `502` and controlled `503` rates by sync operation;
   - pull/push phase p50, p95, and p99 durations;
   - PostgreSQL codes `57014`, `55P03`, `08006`, `25P02`, `25P03`, and `25P04`;
   - delayed `unexpected EOF on client connection with an open transaction` records.
3. Make no payload, connection, or region change while the deployment remains healthy and measurements show no bottleneck.

Acceptance: normal sync stays well below the platform boundary, controlled retryable failures remain rare, and no abandoned transaction survives long enough to block retries.

## 2. Deploy and verify operation-idempotent push delivery

**Status: implementation complete; database rollout and production verification pending.** The receipt schema, duplicate-request validation, atomic claim/skip behavior, focused unit tests, and generated migration are complete. The migration has not been applied by this plan, and replay/concurrency behavior has not been verified against production PostgreSQL.

The receipt schema and atomic claim/skip behavior are implemented, and migration `0008_nosy_mordo.sql` is generated. Before deploying the application code:

1. Apply the additive migration with `pnpm db:migrate`; never use `drizzle-kit push`.
2. Verify lost-response replay, mixed new/replayed batches, concurrent delivery, and same mutation UUIDs under different users against a real PostgreSQL database.
3. Confirm a replay returns the mutation id and current canonical row without advancing `updated_at` or emitting the first attempt's conflict again.
4. Add `RETURNING`-based affected-row collection if canonical reread measurements or guarded no-op behavior justify replacing the current user/profile-scoped reread.

Keep receipts indefinitely until a maximum offline/retry window is explicitly defined.

## 3. Reduce push database work if phase logs justify it

**Status: not implemented and not currently justified.** Preserve the current behavior until production phase logs identify push SQL or balance recomputation as a material bottleneck.

1. Build an `affectedAccountIds` set while applying account and transaction mutations, including both old and new accounts when a transaction moves.
2. Recompute balances once per batch with one set-based aggregate/update over only affected live accounts.
3. Reuse authorization, conflict, and previous-row facts within each mutation run.
4. Avoid rereading the palette unless a category with `colorHex` may have inserted a color.
5. Preserve mutation order and one atomic database transaction per batch.
6. Compare SQL statement counts and phase timings before and after using production-like data.

Do not increase the per-isolate connection count to hide repeated SQL.

## 4. Reduce pull work if phase logs justify it

**Status: not implemented and not currently justified.** The measured successful pull is below the application budget; retain the current pagination and request shape until production data identifies a pull bottleneck.

1. Fetch `PULL_PAGE_SIZE + 1`, return one page, and derive `pending` from the extra row.
2. Request only still-pending tables on continuation pages, followed by a small all-table delta sweep.
3. Fetch colors and currency rates once per sync run rather than once per transaction page.
4. Time the transaction backlog count separately; return indeterminate progress rather than fail a pull if it becomes expensive.
5. Compare the preliminary profile query with an ownership subquery using production-like `EXPLAIN` output.
6. Verify global `(updated_at, id)` ordering across multiple profiles against the existing profile-prefixed indexes.

Do not change the composite cursor, timestamp literal handling, overlap window, tombstones, or local outbox merge protection.

## 5. Calibrate limits and retry behavior

**Status: not implemented; existing foundations only.** Count limits, retained outbox retries, exponential backoff, and sanitized retryable `503` responses already exist. The benchmarks, byte limits, complete outcome classification, `Retry-After` handling, terminal-entry recovery, and adaptive splitting listed below remain pending and measurement-gated.

Only after steps 1–4 produce measurements:

1. Benchmark push counts `50`, `100`, `250`, and `500`, and pull sizes `250`, `500`, `1000`, and `2000`, for cold and warm invocations.
2. Add encoded-byte limits while preserving oldest-first mutation order and guaranteeing progress for one valid mutation.
3. Keep page, service-worker, and server limits compatible during rollout.
4. Classify outcomes as accepted, unauthorized, terminal, or retryable.
5. Keep retryable writes in the outbox, use jittered exponential backoff, and respect `Retry-After`.
6. Block terminal entries with an actionable recovery/export path instead of retrying or discarding them.
7. Consider adaptive splitting only for a typed execution-budget failure shown to correlate with row volume.

## 6. Improve deployment topology only if latency remains material

**Status: partially implemented; topology changes are not currently justified.** Runtime lazy initialization, `max: 1`, `prepare: false`, the short connection timeout, verified TLS support, and distinct runtime/tombstone application names are implemented. Regional benchmarking, independent credentials/endpoints, a confirmed migration endpoint, and tombstone transaction deadlines remain pending.

1. Benchmark regional co-location between Netlify compute and Supabase before moving either service.
2. Separate runtime, migration, and maintenance variable groups and roles if independent endpoints or privileges are needed.
3. Keep runtime lazy initialization, `max: 1`, `prepare: false`, short connection timeout, and a distinct application name.
4. Use a migration-compatible direct or session endpoint for Drizzle migrations; keep runtime serverless traffic on the verified supported pooler.
5. Give tombstone maintenance its own application name, validated configuration, and deadlines below the scheduled-function limit.

## 7. Validate and roll out each remaining change independently

**Status: local validation complete for the current code; deployment validation pending.** Unit tests, typecheck, lint/format checks, diagnostics, and the production build passed. Database migration, preview/canary testing, failure-injection scenarios, production verification, and rollback validation have not been performed.

For each implemented step:

1. Run focused unit/integration tests, typecheck, and the production build.
2. Test connection loss, statement timeout, lock contention, lost responses, service-worker/page races, and cross-user UUID collisions where relevant.
3. Deploy through a preview or canary when configuration, schema, or protocol behavior changes.
4. Verify outbox convergence, exact balances, bounded request duration, and backward compatibility with an already-installed service worker.
5. Roll back application/configuration changes independently. Leave an additive receipt table in place rather than running a destructive down migration during an incident.
6. Update [`docs/architecture.md`](../architecture.md) and [`docs/limitations.md`](../limitations.md) only with behavior proven by the deployment.

A server-side queue or co-located sync worker is an escalation, not a planned first step. Consider it only if a verified, optimized synchronous request still cannot meet the application budget.
