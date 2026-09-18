# Limitations

Known production and design constraints that are not immediate incidents but should guide future changes.

## Database deployment

- Netlify Functions currently run in `CMH` (Ohio), while Supabase PostgreSQL runs in `ap-northeast-1` (Tokyo). The distance adds latency to every database round trip and makes chatty sync queries more expensive.
- Production runtime traffic uses the Supabase transaction pooler on port `6543`. Runtime, Drizzle Kit, and tombstone maintenance explicitly use the CA from `POSTGRES_CA_CERT_BASE64` with certificate verification. Supabase SSL enforcement must only be enabled after those clients are deployed and tested; the dashboard setting remains a separate operational control.
- Runtime, migration, and tombstone-maintenance workloads still use the same `POSTGRES_*` variable group. They cannot yet be assigned independently scoped endpoints, credentials, or deployment contexts.
- `max: 1` limits each warm Netlify isolate, not the aggregate number of connections across isolates. Correct server-side pooling remains necessary.

## Request and transaction budgets

A production incident on 2026-08-29 showed Netlify invocations terminating at an observed 30-second boundary while PostgreSQL sometimes retained open transactions longer. The immediate `502` problem was mitigated by structured phase logs, a short currency-provider abort, and database-side deadlines.

One successful cold pull measured on 2026-08-30 took 18.9 seconds at the Netlify invocation level, but only 5.2 seconds from `sync.request.started` to its `200` response. About 13.7 seconds elapsed before application request logging began. Within the request, session resolution took 2.0 seconds and the pull transaction took 3.1 seconds, including 1,208 transactions. This single sample confirms that platform-level duration must be evaluated separately from logged database phases; it is a baseline, not a latency percentile or service-level target.

Runtime database work now uses:

- a 3-second connection timeout;
- `lock_timeout = 1500ms`;
- `statement_timeout = 6s`;
- `idle_in_transaction_session_timeout = 7s`;
- `transaction_timeout = 20s` on PostgreSQL 17 or newer.

Retryable database failures are returned as sanitized `503 Service Unavailable` responses with `Retry-After: 2`, leaving the local outbox intact. These deadlines intentionally fail before the platform boundary; they do not make a slow database fast. On PostgreSQL versions before 17, there is no whole-transaction wall-clock deadline, only the statement, lock, and idle-transaction protections.

The runtime client keeps one connection per isolate, disables prepared statements as required for transaction-pooler compatibility, and identifies itself as `transactions-tracker-runtime`.

## Push receipts

Push delivery uses a durable receipt keyed by `(user_id, mutation_id)`, written atomically with the mutation. New receipts bind the identity to a full-intent fingerprint and retain any immutable acceptance-time stale-base outcome, so a lost response can be replayed without repeating the write or changing its historical result. Pre-upgrade receipts remain acknowledgeable but have no reconstructable historical outcome. Receipts are retained indefinitely because the maximum offline/retry window has not been defined; their storage growth must be measured before adding any cleanup policy.

Canonical rereads are scoped by user/profile, which prevents the previously identified cross-user disclosure. They still reread submitted IDs after mutation execution instead of collecting only affected rows with SQL `RETURNING`.

## Local replica recovery and browser storage

- IndexedDB v2 ownership can only be reconciled automatically when local profiles prove one unique
  owner. Empty replicas become unbound. Mixed owners, missing owner evidence, or inconsistent
  references enter `recovery-required`: sync/auth binding is blocked, the user can download a local
  JSON export, and discard is explicit. There is no automatic importer for that recovery file yet.
- `navigator.storage.persist()` is best-effort. The browser may still evict IndexedDB or Cache Storage,
  especially under storage pressure or OS-managed installed-PWA lifecycle. Cache eviction removes cold
  offline startup; IndexedDB eviction removes the local replica and unsynced outbox. Neither mechanism
  is a backup.
- A failed or blocked IDB upgrade is not treated as success. The UI can retry after older tabs close,
  but a permanently unavailable/corrupt database still requires browser-level recovery outside the app.

## Browser coordination and updates

- Safe cross-tab sync/auth transitions require Web Locks. Where `navigator.locks` is unavailable, the
  existing local replica remains readable/editable, but synchronization and authentication are paused;
  a per-tab mutex would not protect shared IndexedDB.
- The update policy is passive: no `skipWaiting()` and no `clients.claim()`. A new complete worker takes
  over only after old app windows close and the app is reopened. Rolling back to a pre-v3 client is not
  safe after replica migration.
- The standalone `/pwa-recovery.html` escape hatch can unregister workers and remove this app’s Cache
  Storage after confirming a complete replacement build is online. It deliberately preserves IndexedDB;
  it cannot repair an incomplete server deploy, recover evicted local data, or retroactively appear in
  shells released before the recovery page was shipped.
- Chromium preview tests do not prove iOS/Safari installed-PWA close/reopen, eviction, or update
  lifecycle. Those remain release gates.
- Service-worker Background Sync delivery is intentionally disabled. The worker caches the app shell
  and assets only; the foreground page owns outbox settlement until ADR 0001 provides durable conflict
  notices and completion semantics.

## Sync query cost

- Push batches can repeat authorization and conflict reads across mutation runs.
- Balance recomputation currently touches every live account in each affected profile rather than only accounts whose transactions changed.
- Every foreground sync run first performs an identity-only authenticated preflight. It adds one request, but prevents a mismatched live session from receiving local mutation IDs, row IDs, payloads, or cursors before owner rejection.
- A first pull page performs ownership, four table-page, palette, optional backlog-count, and optional currency-rate operations. With `max: 1`, SQL launched together is still serialized on one connection.
- Pull continuation pages query all synced tables and repeat palette/rate work. An exact full page also requires another request to discover completion.
- Current count limits are safety rails, not measured byte budgets. Reducing them without phase measurements can increase repeated transaction and balance work.

## Retry behavior and observability

Structured request and phase logs identify cold/warm isolates, operation phases, row or mutation counts, durations, and sanitized PostgreSQL classifications. They are diagnostic logs, not a retained metrics system or formal service-level monitor.

The client treats owner mismatches, unsupported/invalid protocol envelopes, and accepted-mutation fingerprint mismatches as terminal, retains the affected outbox entry, and suppresses automatic retries for that run. Unknown non-auth HTTP failures remain retryable because infrastructure can replace an application response. Adaptive batch splitting is intentionally not implemented because connection and lock failures are not evidence that payload size caused the failure.

## Performance evidence

The production request sample above and the 11,584-row development measurements in
`docs/architecture.md` are observations, not percentiles or SLAs. A local production-preview fixture
measured `local-ready` at about 57ms on its first warmed visit and 46ms on a repeated offline visit.
Controlled tests also rendered cached navigation and committed a local edit before separate 15-second
upstream holds were released. These results prove causal independence in Chromium, not representative
data volume, deployment latency, or an SLA; Deploy Preview and post-deploy measurements remain release
gates.

## Background processing

The browser's IndexedDB outbox is the durable queue. A Netlify background function is not a drop-in replacement because push completion must return mutation acceptance, canonical timestamps, and conflict information before outbox entries can be removed. Moving sync to background processing would require a durable server-side queue, idempotency records, job status, and a new completion protocol.
