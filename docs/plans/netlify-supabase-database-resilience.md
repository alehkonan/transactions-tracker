# Netlify–Supabase Database Resilience Plan

This plan addresses the production `502` failures seen while TanStack Start server functions on Netlify
synchronize with PostgreSQL on Supabase. It preserves the offline-first contract in
[`docs/architecture.md`](../architecture.md): reads stay in IndexedDB/Zustand, writes land in the local
outbox first, and PostgreSQL remains a synchronization backend rather than a render-path dependency.

The main conclusion is:

> **Do not solve this first with a global request queue or a Netlify background function.** The browser
> already sends outbox batches and pull pages sequentially. First fix the database connection mode,
> put database work inside an explicit fail-fast budget, make retries operation-idempotent, and remove
> repeated SQL work. Recalibrate payload limits only after those changes are measured.

No new application dependency is required for the preferred path. A durable server-side queue is an
explicit escalation option only if a correctly pooled and optimized synchronous request still cannot
meet the latency budget.

## Investigation boundary

This review used the current repository and official Netlify/Supabase documentation on 2026-08-29.
It now also includes the one-hour production Netlify handler-log excerpt, one `pg_stat_activity`
snapshot, a three-hour Supabase PostgreSQL log export, the effective PostgreSQL timeout settings, and one
failed browser server-function request supplied on that date. It did **not** inspect `.env*` files,
Supabase credentials, historical database metrics, or private Supabase dashboards. The cross-provider
timestamps strongly associate several failures with an open database transaction, while the browser
capture proves that at least one separate client-visible failure is `pullChanges`. The exact phase that
first stalls in either path is still unobserved.

Confirmed deployment facts:

- the runtime connection is reported as Supabase transaction-pooler connectivity on port `5432`;
- Netlify Functions run in `CMH` (Ohio, US East), while Supabase runs in `ap-northeast-1` (Tokyo);
- PostgreSQL is configured with `max_connections = 60`, `statement_timeout = 2min`, and disabled
  `lock_timeout` and `idle_in_transaction_session_timeout`;
- one failed GET server-function request has the input shape of `pullChanges`, returned an empty body,
  and carries Netlify request ID `01M16MF9E2GK1WWTHS0065R6DB`.

The following deployment facts are still unknown and must be recorded without exposing secrets:

- the runtime host category and effective pool mode: the reported `transaction pooler` plus port `5432`
  combination conflicts with the normal shared Supavisor mapping where transaction mode uses `6543`
  and session mode uses `5432`, so it must be verified in Supabase Connect rather than inferred;
- whether SSL is enabled and certificate/hostname verification is enforced;
- the HTTP status and browser-measured duration of the captured failed pull;
- the Netlify invocation associated with request ID `01M16MF9E2GK1WWTHS0065R6DB` and whether it logged
  request start or any pull phase before termination;
- why the deployed Netlify request path has an effective 30-second boundary despite the documented
  synchronous limit and the absence of a repository-level timeout setting;
- which pull connection/query/rates phase stalls, and which mutation, balance, lock, or connection phase
  keeps the matched transactions open;
- Supabase CPU, connection, pooler-client, and backend-connection saturation at failure time.

## Production evidence captured on 2026-08-29

The supplied excerpt contains 28 handler invocation records. It changes the investigation in several
important ways:

| Observation                    | Evidence in the supplied excerpt                                                                                            | Interpretation                                                                                                                                     |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact 30-second boundary       | 9 of 28 invocations report `Duration: 30000 ms`                                                                             | This is a deterministic deadline, not merely requests being generally slow. Its owner is not identified yet.                                       |
| Missing application completion | None of those nine invocation IDs has a `loggerMiddleware` completion/error line                                            | The process or awaited dependency did not return through the current logger. Completion-only logging cannot name the operation.                    |
| Large pre-middleware latency   | Four correlated successful invocations take 14.6–17.1 seconds overall while the logged operation takes only 1.1–3.2 seconds | Approximately 12–14 seconds occurs before the current middleware timer, consistent with a cold-start/module-load layer or other pre-dispatch work. |
| Fast warm sequence             | Six consecutive `pullChanges` calls take 1.7–2.0 seconds overall and 1.7–1.8 seconds inside middleware                      | Pull and database access can complete normally; the problem is intermittent rather than a universal 30-second query cost.                          |
| Authentication baseline        | Logged `getSignInOptions` calls take 0.57–1.48 seconds and `signIn` calls take 1.12–1.16 seconds                            | The database path is not uniformly unavailable, although these timings are still slow enough to measure by phase.                                  |
| No obvious memory boundary     | Reported memory stays between 281 MB and 315 MB, including failed invocations                                               | The excerpt does not indicate memory exhaustion or monotonic growth as the immediate cause.                                                        |

The four-hour difference between the Netlify line prefix and the application's embedded timestamp also
makes manual correlation error-prone. New structured records must use ISO UTC timestamps and a shared
request ID rather than local formatted time.

The exact 30-second starts to correlate in Netlify's displayed timezone are `14:14:51`, `14:15:51`,
`14:18:25`, `14:22:49`, `14:23:19`, `14:23:49`, `14:29:02`, `14:29:56`, and `14:40:52`. Inspect the
corresponding 30-second windows in Supabase metrics and logs. Do not infer that all nine are sync calls
until browser paths or new start records identify them.

This sample strengthens the case for observability and fail-fast budgets, but it does **not** support
reducing payloads first. Warm pulls already finish in about two seconds, while the unexplained cold-like
layer alone consumes almost half of the observed 30-second budget.

### Captured failed pull, timeout settings, and regional topology

The captured browser request is a GET to TanStack Start's generated `/_serverFn/<hash>` endpoint. Its
serialized input contains the four sync cursors and `withCounts`, which identifies it as `pullChanges`.
The response has an empty body, a Netlify `Date` of `2026-08-29T11:29:36Z`, and
`x-nf-request-id: 01M16MF9E2GK1WWTHS0065R6DB`. The HTTP status and browser-measured duration were not
included, so this capture cannot yet be tied conclusively to an exact 30-second invocation. Search the
Netlify logs by that request ID; if the browser duration was approximately 30 seconds, also inspect the
window beginning around `11:29:06Z`.

This proves that at least one production failure is a pull, not a transaction-bearing push. It does not
invalidate the open-transaction correlation below: there are likely multiple failure modes, or one shared
connection/network failure affecting both pull and push while only push leaves a transaction open.
Instrument both paths and do not classify the generated server-function hash as an operation without
logging the operation name inside the application.

The effective PostgreSQL settings are:

| Setting                               | Value  | Consequence                                                                                                                                                                                     |
| ------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `max_connections`                     | `60`   | A constrained backend budget, but the activity snapshot does not show saturation. Supavisor metrics are required because serverless client concurrency is not represented by this number alone. |
| `statement_timeout`                   | `2min` | A statement can outlive the observed 30-second Netlify boundary by a wide margin. Runtime requests need much shorter transaction-local limits.                                                  |
| `lock_timeout`                        | `0`    | Lock waits are unbounded until `statement_timeout` or connection termination.                                                                                                                   |
| `idle_in_transaction_session_timeout` | `0`    | An abandoned idle transaction has no PostgreSQL-side cleanup deadline.                                                                                                                          |

These cluster/session defaults explain why PostgreSQL does not protect the application from the platform
boundary. They do not prove that a statement actually ran for two minutes; the `08006` records are client
disconnects rather than statement-timeout records. Apply shorter settings with `SET LOCAL` inside runtime
transactions instead of changing global Supabase settings for every workload.

The runtime is reported as a transaction pooler on port `5432`. For the standard shared Supavisor
endpoint, `5432` normally denotes session mode and `6543` transaction mode. Verify the selected Connect
mode, host category, and deployed port together. If this is a dedicated pooler or Supabase now presents a
different mapping for this project, follow the exact project-specific connection instructions rather than
changing the port from documentation alone.

Netlify `CMH` and Supabase `ap-northeast-1` are geographically far apart. Multiple sequential database
round trips over this path plausibly explain much of the normal 1.7–2.0 second warm-pull baseline: the
first pull page performs several SQL operations and the single Postgres.js connection serializes them.
Geography alone does not explain the intermittent exact 30-second boundary, but it magnifies every
chatty query path and reduces the available failure budget. Co-location is now a high-value infrastructure
option to benchmark.

### PostgreSQL disconnect correlation

The Supabase export contains four PostgreSQL `08006` events saying `unexpected EOF on client connection
with an open transaction`. After normalizing the Netlify dashboard's four-hour display offset against the
application's UTC timestamps, three Netlify boundaries correlate with those events:

| Netlify invocation | Displayed start | 30-second boundary in UTC | PostgreSQL EOF in UTC | Delay after boundary |
| ------------------ | --------------- | ------------------------- | --------------------- | -------------------- |
| `dc940fc5`         | `14:15:51`      | `10:16:21`                | `10:18:21.377`        | about 120.4 s        |
| `d5009b43`         | `14:18:25`      | `10:18:55`                | `10:20:55.638`        | about 120.6 s        |
| `d59bd03b`         | `14:29:56`      | `10:30:26`                | `10:32:26.466` twice  | about 120.5 s        |

The repeated two-minute interval is unlikely to be coincidental. It strongly indicates that the
Netlify-facing invocation stopped at 30 seconds while one or more database sessions remained connected
with an open transaction until later environment or network cleanup. PostgreSQL rolls an open
transaction back when that connection finally disappears, but during the intervening window it can
retain a backend and locks.

This explains how sequential browser requests can still overlap at the database: the browser waits for
the failed request, but its abandoned transaction can outlive the HTTP response and block a retry from a
new invocation. The retry can then hit the same 30-second boundary, creating a failure cascade.

`executePush` explicitly wraps mutation application and balance recomputation in a transaction, whereas
`pullChanges` does not. The matched `08006` events therefore still require a transaction-bearing path such
as `pushChanges`, `/api/push`, or authentication internals. Separately, the captured failed request proves
that pull also fails in production. The optional currency-rate fetch is consequently a first-deploy pull
priority, but it cannot explain the open-transaction events because it does not run inside the push
transaction.

The export does **not** identify the first cause inside the transaction. A blocked balance statement,
lock contention, slow mutation SQL, pooler/network interruption, or application work can all leave the
transaction open. It also does not associate all nine 30-second invocations with PostgreSQL; those may
include other operations. PostgreSQL phase timing and wait-event capture are still required.

The export labels these records `success`, but SQLSTATE `08006` and the message text represent an
abnormal client disconnect, not a successful application transaction.

### Supabase activity snapshot

The supplied `pg_stat_activity` result contains seven connections: Supabase infrastructure workers,
PostgREST, one idle Supavisor backend, and the active dashboard query itself. It shows:

- no active application query other than the dashboard query;
- no lock wait or long-running transaction visible in that instant;
- no connection-count saturation in that instant;
- expected `ClientRead` waits on idle services, which mean PostgreSQL is waiting for the client rather
  than the client waiting for PostgreSQL;
- expected extension waits for `pg_cron`/`pg_net` workers.

This is a healthy-looking **instantaneous snapshot**, not evidence that the database was healthy during
the earlier 30-second failures. Runtime connections can disappear after the configured 20-second idle
timeout, and pooled clients may be represented by Supavisor rather than by the originating Netlify
application's name. The presence of a `Supavisor` row confirms that the project runs the pooler service;
it does not prove which deployed host/port pair the application uses.

The settings were subsequently captured in one row: `max_connections = 60`,
`statement_timeout = 2min`, `lock_timeout = 0`, and `idle_in_transaction_session_timeout = 0`. The
unbounded lock and idle-transaction settings, plus a statement budget four times the observed request
boundary, make request-local deadlines mandatory.

## Confirmed findings

### 1. Sync requests are already sequential in the browser

The proposed “send requests only sequentially” behavior already exists:

- `src/modules/sync/sync-engine.ts` holds a browser-wide Web Lock around a complete sync run;
- `src/modules/sync/outbox-acceptance.ts` waits for each push batch before reading and sending the next;
- `src/modules/sync/sync-run.ts` waits for each pull page before requesting the next;
- `public/sw.js` uses the same lock name for Background Sync where Web Locks are available.

Different devices can still send requests concurrently, which is expected. Serializing all users or
all devices in application code would create a new bottleneck and would not repair slow connection
setup. Supabase's transaction pooler should absorb transient serverless concurrency instead.

### 2. The documented Netlify limit and the observed production boundary differ

`src/api/sync.functions.ts`, `src/modules/sync/sync-engine.ts`,
`src/modules/sync/sync-types.ts`, and `docs/architecture.md` size work around a stated 10-second
Netlify limit. Current Netlify documentation lists:

- **60 seconds** for synchronous Functions;
- **30 seconds** for scheduled Functions;
- **6 MB** for buffered request/response payloads.

The regular TanStack server functions are synchronous, not scheduled, and neither `netlify.toml` nor
`vite.config.ts` configures a 30-second function timeout. Nevertheless, the supplied production sample
contains nine invocations at exactly `30000 ms`. Treat 30 seconds as the **effective observed request
boundary** until the deployed function metadata and browser response explain it.

The later PostgreSQL EOF correlation makes an exact 30-second dependency timeout a less complete
explanation: the database still saw open client transactions approximately two minutes after several
Netlify request boundaries. A database query or lock can be the original reason the operation fails to
finish, but Netlify or its request path appears to enforce the client-visible cutoff while underlying
resources can linger.

The implementation must target a much shorter application budget regardless of whether the documented
60-second ceiling is available. Waiting close to either boundary is unacceptable for interactive sync
and amplifies retries.

### 3. The database client is not explicitly configured for Supabase serverless transaction pooling

`src/database/get-db.server.ts` currently creates Postgres.js with:

- one connection per warm Netlify isolate (`max: 1`);
- a 20-second idle timeout;
- a 10-second connect timeout;
- no explicit SSL configuration;
- no explicit prepared-statement setting;
- no statement, lock, or transaction timeout;
- the same `POSTGRES_*` variables used by Drizzle migrations and tombstone GC.

Supabase's current guidance is to use **transaction-pooler mode on port `6543` for serverless or edge
functions**. Transaction mode does not support prepared statements, while Postgres.js enables them by
default. Runtime use of the transaction pooler therefore requires `prepare: false`.

Production is reported as using a transaction pooler on port `5432`, but that combination does not match
the standard shared Supavisor port mapping. Verify the deployed host category, Connect-panel mode, and
port as one unit. Three configurations are especially risky:

1. **Direct endpoint from Netlify:** each autoscaled isolate can consume a real backend connection;
   the direct Supabase endpoint is IPv6 unless the project has the IPv4 add-on.
2. **Session pooler unintentionally used on port `5432`:** every warm Netlify isolate can retain a pooled
   session, reducing the benefit expected from transaction pooling on a 60-connection database.
3. **Transaction pooler with current driver defaults:** prepared statements are incompatible with
   transaction pooling and can fail intermittently as pooled backend sessions change.

`max: 1` should remain initially. It limits each isolate, but it does not cap aggregate connections
across all Netlify isolates; that is the server-side pooler's job.

### 4. Push cost is dominated by repeated database work, not only payload size

A normal transaction-only push can execute roughly eight or nine application SQL statements plus
transaction control. A mixed import batch can execute substantially more because consecutive
mutation runs repeat authorization and conflict reads.

The largest avoidable cost is in `src/api/apply-mutations.server.ts`:

- every run outside `profiles` rereads all owned profile IDs;
- every run separately reads conflicts and repeats ownership checks;
- transaction runs validate account and category IDs before the upsert;
- after the batch, `recomputeBalances` restates **every live account in every touched profile** with a
  correlated transaction sum.

Reducing the push limit from 500 to 100 before fixing that final balance query can make a large import
_worse_: the same profile-wide recomputation runs five times as often. A count limit is useful as a
safety rail, but it is not the root fix.

### 5. Pull pages fan out into many operations on one connection

The first `pullChanges` page performs:

1. one profile-ownership query;
2. four table page queries;
3. one full palette query;
4. one transaction backlog count when `withCounts` is true;
5. one external currency-rate HTTP request.

With `max: 1`, the SQL issued through `Promise.all` cannot provide true database parallelism. A pull
can return up to 2,000 rows **per table**, although transactions are normally the only table that
fills a page. The currency fetch in `src/api/currency-rates.server.ts` has no abort deadline and can
hold a pull open even though rates are optional.

`pending` is currently inferred by receiving exactly 2,000 rows. An exact 2,000-row result therefore
requires another mostly empty request just to discover that the table is complete.

### 6. A timeout after commit is an ambiguous success

`src/api/push-execution.server.ts` commits the mutation transaction and then reads canonical rows and
colors. If the commit succeeds but a post-commit read, serialization, or response delivery fails, the
client retains the outbox entries and retries them.

Whole-row upserts make the resulting values mostly state-idempotent, but the operation is not fully
idempotent:

- the server does not deduplicate the existing `mutationId`;
- an upsert retry advances `updated_at` again;
- the retry can report a false conflict against its own earlier successful commit;
- another device may update the row between the first commit and the retry, after which the retry can
  overwrite that newer change.

The current failure mode is therefore not only extra load; it can change conflict behavior.

### 7. The current logs cannot identify the failing phase

`src/api/logger.middleware.ts` records only total duration after a server function finishes or throws.
A platform termination can prevent that final log from running. The log omits PostgreSQL error codes,
connection mode, phase timings, request correlation, payload sizes, row counts, and retry identity.

The service-worker route in `src/routes/api/push.ts` bypasses `loggerMiddleware` completely. Its
failures cannot currently be distinguished from page-originated pushes in application logs.

### 8. Adjacent security defect discovered in the push response

This is not the likely `502` cause, but it must be fixed while changing the push path:

- `applyMutations` adds every submitted row ID to `touched` before knowing whether a guarded upsert
  actually affected that row;
- the `setWhere` guard correctly prevents writing another user's existing UUID;
- `readCanonicalRows` then reads touched rows solely by ID, without user/profile ownership scope;
- `executePush` marks every submitted mutation ID as applied.

A submitted UUID colliding with another user's row can therefore produce a guarded no-op write but
still return that other user's canonical row. Replace submitted-ID rereads with affected rows from
`RETURNING`, and add explicit cross-user tests before performance work lands.

## Target behavior and budgets

The implementation should be designed to meet these production targets under the current expected
working set, not merely stay below Netlify's 60-second hard limit:

| Measure                           | Target                                                        |
| --------------------------------- | ------------------------------------------------------------- |
| Warm sync request p95             | `< 3 s`                                                       |
| Cold sync request p95             | `< 5 s`                                                       |
| Application/database hard failure | controlled `503` before `8 s`                                 |
| PostgreSQL lock wait              | fail in approximately `1–1.5 s`                               |
| Optional currency-rate fetch      | fail open in approximately `1 s`                              |
| Platform-generated `502` rate     | `< 0.1%` of sync requests                                     |
| Lost-response replay              | no second write, no second timestamp advance, no false toast  |
| Push/pull ordering                | sequential per browser; safe concurrency across devices       |
| Offline behavior                  | unchanged; outbox persists and retries after transient errors |

These are initial service-level objectives. Adjust them from staging and production measurements, but
keep a large margin below the platform limit.

## Work summary

| #   | Work                                                | Primary files                                                                                                      | Risk   |
| --- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------ |
| 0   | Capture the real production failure                 | Netlify logs/settings, Supabase dashboard/SQL                                                                      | low    |
| 1   | Correct runtime connection topology                 | `get-db.server.ts`, `drizzle.config.ts`, `tombstone-gc.ts`, deployment variables, docs                             | high   |
| 2   | Add phase logs and fail-fast budgets                | `logger.middleware.ts`, sync/push modules, `currency-rates.server.ts`, `/api/push`                                 | medium |
| 3   | Close the canonical-row leak and deduplicate pushes | `tables.ts`, generated migration, `apply-mutations.server.ts`, `push-execution.server.ts`, `push.server.ts`, tests | high   |
| 4   | Reduce push SQL and balance work                    | `apply-mutations.server.ts`, `push-execution.server.ts`, tests                                                     | high   |
| 5   | Reduce pull fan-out and unnecessary payload         | `sync.functions.ts`, `sync-run.ts`, sync types/tests                                                               | medium |
| 6   | Calibrate count/byte limits and retry behavior      | sync schemas/types, outbox modules, `sw.js`, sync UI/tests                                                         | medium |
| 7   | Stage, measure, and roll out                        | deploy configuration, dashboards, `architecture.md`                                                                | medium |

Suggested order after the open-transaction and failed-pull evidence: **finish endpoint verification →
first deploy with pull/push phase logs, currency abort, and transaction deadlines from 2 → correct and
canary the verified runtime topology from 1 → 3 → 4 → measure → 5 → 6 → 7**. Connection configuration
may join the first deploy only after the reported transaction-mode/port mismatch is resolved. Do not wait
for SQL optimization to prevent abandoned transactions from surviving the request boundary, and do not
tune batch sizes blindly before the dominant phase is known.

### First deployment implemented locally on 2026-08-29

The first application deployment is now implemented but not yet deployed:

- structured JSON request/phase logging with UTC timestamps, isolate/request IDs, cold/warm markers,
  operation names, row/mutation counts, PostgreSQL classifications, and a bounded log-record count;
- equivalent request handling for TanStack server functions and `/api/push`;
- three-second connection timeout, `application_name`, `max: 1`, and `prepare: false`; the host, port,
  SSL mode, and credentials remain unchanged;
- transaction-local `lock_timeout = 1500ms`, `statement_timeout = 6s`, and
  `idle_in_transaction_session_timeout = 7s` on pull, push, integrity, and session database work;
- conditional `transaction_timeout = 8s` on PostgreSQL 17 and newer. Older PostgreSQL versions do not
  expose this setting and therefore retain per-statement/lock/idle protection rather than a guaranteed
  whole-transaction wall-clock deadline;
- read-only, repeatable-read transactions for pull pages, integrity checks, session refresh, and
  post-push canonical reads;
- retryable Drizzle/Postgres.js/PostgreSQL errors, including wrapped `.cause` errors, converted to a
  sanitized `503` with `Retry-After: 2`;
- a one-second currency-provider abort plus a five-minute failure backoff, with rates still fail-open;
- canonical rereads scoped by user/profile as an interim defense against the discovered cross-user row
  disclosure. Mutation `RETURNING` and receipts are still required in step 3.

Validation completed locally: formatter and targeted lint passed, TypeScript passed, all 111 unit tests
passed, the production client/SSR build passed, and `git diff --check` passed before the final review
adjustments. No schema, migration, payload limit, browser sequencing, endpoint, SSL, or region change is
included.

**Production deployment gate:** verify the Supabase Connect host category, effective pool mode, and
`5432` port together, and determine the SSL mode. `prepare: false` is safe in session mode and required in
transaction mode, but it does not prove that the intended pool mode is active. Deploy through a Preview
or canary and inspect the new phases before broad rollout.

---

## 0. Capture the real production failure

### Netlify checks

Use **Logs & Metrics → Functions** for the published deploy and correlate failed browser requests with
invocation request IDs. Record:

- browser request URL/path, method, status, elapsed time, sanitized response body, and
  `x-nf-request-id` or equivalent correlation header;
- invocation start and end/termination time;
- whether the deployed function metadata or site settings expose an effective maximum duration;
- cold versus warm invocation and initialization time where visible;
- complete error text and stack;
- whether a corresponding application start, phase, and completion log exists;
- Functions region, effective Node runtime, and deployed Netlify adapter/plugin version.

The generated TanStack SSR/server-function handler appears as one wildcard Function rather than one
Function per exported server function in the supplied logs. The current completion record names only
calls that return through middleware, which is why none of the exact 30-second IDs can yet be classified.
Correlate using browser path, request ID, server-function metadata, and the new request/phase logs from
step 2.

For the next reproduction, preserve one failed browser Network entry as a HAR or copy only its sanitized
request path, status, duration, response headers, and response body. This is the shortest path to proving
whether a `30000 ms` invocation is `pullChanges`, `pushChanges`, `/api/push`, SSR, or unrelated work.

### Supabase checks

At the same timestamps—especially the nine 30-second windows listed in the captured-evidence
section—inspect:

- Database CPU and memory pressure;
- Database Connections;
- Shared Pooler client connections;
- Dedicated Pooler client connections, if applicable;
- slow query, pooler, authentication, connection, and Postgres logs;
- Query Performance/`pg_stat_statements` entries whose calls or mean/max execution time jump in those
  windows;
- project pause/restart events.

A flat Supabase graph with no matching connection, query, or error event would materially weaken the
database-root-cause hypothesis and move attention to Netlify cold initialization or the currency-rate
fetch. Saturated clients/backends, long waits, or matching SQL errors would strengthen it.

Run these read-only checks from the Supabase SQL editor. Return the settings in one row because the
editor may display only the last result set from a multi-statement run:

```sql
select
  current_setting('max_connections') as max_connections,
  current_setting('statement_timeout') as statement_timeout,
  current_setting('lock_timeout') as lock_timeout,
  current_setting('idle_in_transaction_session_timeout')
    as idle_in_transaction_session_timeout;

select
  application_name,
  usename,
  state,
  wait_event_type,
  wait_event,
  count(*) as connections
from pg_stat_activity
where datname = current_database()
group by application_name, usename, state, wait_event_type, wait_event
order by connections desc;
```

When a failure is active, inspect long-running or waiting statements without copying sensitive bind
values into the plan or logs:

```sql
select
  pid,
  application_name,
  state,
  wait_event_type,
  wait_event,
  now() - query_start as query_age,
  now() - xact_start as transaction_age,
  pg_blocking_pids(pid) as blocking_pids
from pg_stat_activity
where datname = current_database()
  and state <> 'idle'
order by query_start;
```

### Record the endpoint safely

Log or write down only:

- host category: `db.*.supabase.co`, `*.pooler.supabase.com`, or other;
- port;
- direct/session/transaction mode;
- whether SSL and prepared statements are enabled;
- Netlify and Supabase regions.

Never log a password, full connection string, cookies, row payloads, or full database hostname when a
project reference is considered sensitive.

### Diagnostic interpretation

| Evidence                                                       | Likely issue                                  | First action                                                      |
| -------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------- |
| `select 1` or connection startup itself takes seconds/timeouts | endpoint, DNS, IPv6, pool saturation, project | correct pooler/region; inspect Supabase health; upgrade if needed |
| prepared-statement errors while using port `6543`              | transaction pooler + `prepare: true`          | deploy `prepare: false` for runtime traffic                       |
| `ENETUNREACH` on `db.*.supabase.co`                            | direct IPv6 endpoint unreachable              | use shared transaction pooler or provision IPv4 correctly         |
| password error after changing pool mode                        | wrong pooler username format                  | copy the exact runtime credentials from Supabase Connect          |
| lock wait near the failure duration                            | concurrent writes/balance update contention   | add `lock_timeout`; narrow balance updates                        |
| query execution dominates while connection is fast             | SQL/query plan or compute saturation          | steps 4–5; inspect `EXPLAIN (ANALYZE, BUFFERS)` in staging        |
| invocation disappears with no completion log                   | platform/upstream hard termination            | start/phase logs; keep database budget far below the boundary     |
| rates phase is last visible event                              | unbounded external fetch                      | add the short abort in step 2                                     |

### Emergency mitigation

If production is currently unusable:

1. verify the endpoint before changing payload sizes;
2. make transaction-local lock, statement, and idle-in-transaction deadlines the first statements in
   every push transaction so no abandoned transaction can survive the application budget;
3. add start and transaction-phase records in the same deploy;
4. switch runtime traffic to the supported transaction pooler with `prepare: false` if it is currently
   direct or incorrectly configured;
5. keep `max: 1`;
6. if Supabase shows sustained CPU or backend-connection saturation, temporarily upgrade compute or
   reduce traffic while query changes are prepared;
7. reduce push/pull row limits only when logs show duration growing with row count.

If a pooled `select 1` still takes many seconds, application batching cannot repair the underlying
provider condition. Upgrade, relocate, or migrate the database before adding queue complexity.

---

## 1. Correct runtime connection topology

### Separate connection purposes

The current `POSTGRES_*` variables serve three workloads with different requirements. Split them:

- **Runtime** — TanStack server functions and `/api/push`;
- **Migration** — Drizzle Kit during controlled deploys;
- **Maintenance** — tombstone GC.

Use explicit variable groups such as:

- `RUNTIME_POSTGRES_USER/PASSWORD/HOST/PORT/DB`;
- `MIGRATION_POSTGRES_USER/PASSWORD/HOST/PORT/DB`;
- `MAINTENANCE_POSTGRES_USER/PASSWORD/HOST/PORT/DB`.

Update `README.md` and `.env.example` with names and purpose only; never add real credentials. In
Netlify, migration credentials need **Builds** scope, while runtime and maintenance credentials need
**Functions** scope. Give Production, Deploy Previews, and Branch Deploys intentional values; do not
let a preview migrate production accidentally.

This split aligns with `docs/plans/rls.md`: runtime, migration/owner, and maintenance roles should also
be distinct when that plan is implemented.

### Runtime connection

Configure `src/database/get-db.server.ts` for Supabase's serverless mode:

- shared Supavisor transaction pooler on port `6543` for the normal low-cost/IPv4 path, or the
  dedicated transaction pooler where the paid plan and networking support it;
- exact pooler username from Supabase Connect, commonly including the project reference;
- `prepare: false`;
- `max: 1`;
- explicit SSL, preferably CA and hostname verification according to Supabase's `verify-full`
  guidance;
- a short `connect_timeout`, initially about 3 seconds;
- a distinct `application_name`, such as `transactions-tracker-runtime`;
- runtime validation that all required variables and a numeric port are present before constructing
  Postgres.js.

Keep lazy initialization inside `getDb()` and the `globalThis` cache. Do not create a top-level
connection or move database code into the client bundle.

### Migration connection

Configure `drizzle.config.ts` with the migration variables. Prefer the direct endpoint for migrations
when the Netlify build environment can reach it. If IPv6 is unavailable, use a provider-supported
migration-compatible session path rather than the transaction pooler. Prepared statements may remain
enabled for this non-transaction-pooled connection.

Do not change the migration workflow: generate with `pnpm db:generate`, then run `pnpm db:migrate`;
never use `drizzle-kit push`.

### Maintenance connection

Update `netlify/functions/tombstone-gc.ts` to use maintenance variables, SSL, validation, a distinct
`application_name`, and deadlines below Netlify's 30-second scheduled-function limit. Transaction
pooling is acceptable if every statement is self-contained and prepared statements are disabled; a
separate maintenance/session connection is also reasonable if the role and connection budget are
controlled.

### Region

The current path is Netlify `CMH` (Ohio, US East) to Supabase `ap-northeast-1` (Tokyo). Measure connection
and individual SQL phase timings, then benchmark either placing Netlify Functions in the nearest
available region to Tokyo or moving the database nearer the application's users and compute. Netlify's
current docs say framework-generated functions should use the project-level Functions region in the
dashboard. Region selection may require the appropriate Netlify plan.

This distance is expected to penalize every round trip and likely contributes to the approximately
two-second warm-pull baseline, but do not present relocation as the sole fix for exact 30-second failures.
Verify improvement using the new phase logs and keep fail-fast database deadlines regardless of region.

### Acceptance criteria

- cold and warm `select 1` timings are visible;
- runtime logs show the intended endpoint category, port, SSL state, `prepare: false`, and application
  name without revealing secrets;
- runtime connection errors fail before the endpoint budget;
- migrations still run through their separate credential and endpoint;
- GC is distinguishable from app traffic in `pg_stat_activity`;
- production, preview, and branch contexts cannot accidentally share migration credentials without an
  explicit decision.

---

## 2. Add phase logs and fail-fast budgets

### Structured request logs

Replace completion-only sync logging with concise structured JSON records. Keep each invocation under
Netlify's log-size constraints. Emit at least:

1. `runtime.isolate.initialized` once at module evaluation with an opaque isolate ID and ISO UTC time;
2. `sync.request.started` as the first middleware instruction, before authentication/database work;
3. phase completion/failure records;
4. `sync.request.completed` with total duration and status.

Reuse the isolate ID on every request record and mark only its first request as cold. This separates
module initialization/pre-dispatch time from authentication and database time: if Netlify reports a
30-second invocation but no `sync.request.started`, the stall is outside the server-function body; if a
start and phase records exist without completion, the last phase narrows the awaited dependency.

Fields:

- request/correlation ID;
- operation: pull, page push, worker push, integrity;
- cold/warm isolate flag;
- mutation count and a table/operation histogram, never mutation payloads;
- pull cursor presence, requested tables, `withCounts`, and returned row counts;
- estimated request and response bytes;
- connection, transaction, authorization, conflict, mutation, balance, canonical-row, palette,
  currency, and serialization durations as applicable;
- PostgreSQL `code`, `severity`, and timeout/lock classification;
- count of mutation IDs seen before, but not the IDs themselves;
- final status and retryable/terminal classification.

Equivalent instrumentation now wraps `src/routes/api/push.ts`. Keep the shared push execution module as
the deep interface so the RPC and HTTP route cannot diverge.

### Database deadlines

Add deadlines below the eight-second request target:

- connection timeout: approximately 3 seconds;
- transaction-local `lock_timeout`: approximately 1–1.5 seconds;
- transaction-local `statement_timeout`: approximately 5–6 seconds;
- transaction-local `idle_in_transaction_session_timeout`: below the endpoint budget;
- transaction-local `transaction_timeout`: approximately 8 seconds when PostgreSQL 17+ supports it.

Use PostgreSQL/driver cancellation, not a bare `Promise.race` that returns while a query continues to
occupy the single connection. Convert controlled connection, lock, and statement timeouts into a
sanitized `503 Service Unavailable`, optionally with `Retry-After`. Preserve detailed provider fields
in server logs only.

A statement timeout is per statement, not a whole-request deadline. The implementation conditionally
sets PostgreSQL 17+'s `transaction_timeout`; on older versions, phase timings and reduced SQL work must
still keep the full transaction below the application budget. The transaction-local values are the first
application database operation after `BEGIN`, so an early ownership/conflict query cannot run without
protection.

`pullChanges` currently performs standalone reads, so push-only `SET LOCAL` settings would leave the
captured failing path under the unsafe two-minute database default. Give pull SQL the same bounded
statement behavior using real driver/PostgreSQL cancellation. Two acceptable designs to evaluate during
implementation are:

- execute only the database portion of one pull page in a short read-only transaction and install
  transaction-local deadlines before its first ownership/page query; keep the currency HTTP request
  outside that transaction; or
- use Postgres.js's supported query cancellation/session startup parameters if they are compatible with
  the verified Supavisor mode and cannot leak session state across transaction-pooled clients.

Do not add a bare JavaScript timer that abandons the promise while PostgreSQL continues. If a read-only
transaction is used, `statement_timeout` bounds an active query and `idle_in_transaction_session_timeout`
must clean it up if Netlify terminates between statements.

The observed two-minute connection tail makes these server-side deadlines correctness protection, not
only a latency optimization. Even if Netlify stops waiting first, PostgreSQL must independently cancel
active statements and terminate an idle transaction before it can block a retry.

### Optional currency data

`src/api/currency-rates.server.ts` now uses an abort signal with a one-second deadline and backs off for
five minutes after a provider failure. A failure remains `null` to the pull caller and the client keeps
cached rates. The failure is logged as a sanitized warning; the optional request cannot consume the
database request's budget. This improves pull resilience but does not explain the correlated
open-transaction failures.

### Architecture documentation

Once thresholds are proven, update `docs/architecture.md` and stale comments that refer to a
10-second Netlify limit. Document the application's own short budget separately from the platform's
60-second maximum so future page-size changes optimize for UX rather than the hard ceiling.

---

## 3. Close the canonical-row leak and deduplicate pushes

This step is correctness work required before more aggressive retries or shorter timeouts. The first
deployment adds ownership predicates to all canonical rereads, closing the immediate cross-user row
disclosure. The deeper affected-row and replay correctness work below remains.

### Return only rows actually affected

Refactor mutation statements to use `RETURNING` and collect canonical rows while the mutation
transaction is still open:

- an authorized insert/update/tombstone returns its row;
- a `setWhere` no-op returns nothing and must not be marked as applied silently;
- returned rows are already scoped by the authorized statement;
- rows submitted by ID but not affected are never reread by an unscoped query.

Keep a user/profile predicate on any remaining canonical read as defense in depth. Add tests proving
that a UUID belonging to another user is neither changed, confirmed, nor returned.

This also removes most post-commit canonical queries and narrows the commit-to-response ambiguity
window.

### Add server-side mutation receipts

Add a Drizzle table to `src/database/tables.ts`, for example `sync_mutation_receipts`, with:

- `user_id` referencing `users.id` with cascade deletion;
- `mutation_id uuid`;
- `applied_at timestamptz default now()`;
- a composite primary key or unique constraint on `(user_id, mutation_id)`;
- an index on `applied_at` only if a retention policy is later introduced.

Generate and review the migration. Do not hand-write the generated migration.

Inside the same transaction as the data mutation:

1. find receipts already present for the incoming mutation IDs;
2. skip the corresponding operations without changing `updated_at` or generating conflicts again;
3. apply unreceipted mutations in original outbox order;
4. insert receipts for successfully applied mutations;
5. return all newly applied and previously receipted IDs as accepted.

A replayed mutation does not need to return a canonical row if it performed no new write: the existing
push-first flow immediately follows with a pull, which advances cursors and settles server timestamps.
The client must be tested with an empty canonical-row set for an accepted replay.

Initially keep receipts indefinitely. This application has a small working set, and deleting a receipt
while a device can still retain the corresponding outbox entry reintroduces the lost-response race.
Define retention only after measuring growth and specifying a maximum retry/offline window.

### Lost-response tests

Extend `src/api/push-execution.test.ts` and integration coverage:

- first call commits but response/canonical delivery fails;
- retry with the same `mutationId` confirms success without running the upsert again;
- `updated_at` is unchanged by the replay;
- a later mutation from another device is not overwritten by replaying the old mutation;
- conflicts are emitted once, not once per delivery attempt;
- mixed batches with old and new receipts preserve dependency order;
- a cross-user UUID collision returns no foreign row.

---

## 4. Reduce push SQL and balance work

### Track affected accounts, not whole profiles

Replace profile-wide balance recomputation with an `affectedAccountIds` set built during mutation
processing:

- account upsert: the account itself;
- transaction insert: the new account, when non-null;
- transaction update/move: both the previous and new account IDs;
- transaction delete: the previous account ID;
- account/profile tombstone: do not recompute an account that is itself no longer live;
- cascades: include any still-live account whose transaction set changed.

Reuse the existing-row/conflict read to capture previous transaction account IDs rather than adding a
separate query.

Recompute balances once per batch with one set-based aggregate/update, conceptually:

```sql
with computed as (
  select
    a.id,
    a.initial_balance + coalesce(sum(t.amount) filter (where t.deleted_at is null), 0) as balance
  from accounts a
  left join transactions t on t.account_id = a.id
  where a.id = any($1)
    and a.deleted_at is null
  group by a.id, a.initial_balance
)
update accounts a
set balance = computed.balance
from computed
where a.id = computed.id;
```

Keep the recomputation absolute rather than applying deltas. That preserves state idempotency and
avoids floating/money drift while removing repeated scans of unrelated accounts.

Verify the query with `EXPLAIN (ANALYZE, BUFFERS)` against production-like data. The existing
`transactions_account_id_created_at_idx` may be sufficient; add or change an index only when the plan
shows a real scan problem.

### Reduce repeated reads

After affected-row `RETURNING` is in place:

- collect canonical rows during mutation execution instead of rereading by table after commit;
- reuse authorization/conflict facts inside a run;
- avoid rereading the entire palette unless a category carrying `colorHex` may have inserted a color;
- preserve run ordering so a parent created earlier in a batch is visible to its dependent mutation;
- keep the whole batch in one database transaction.

Do not increase `max` above one to hide chatty SQL. On the constrained database that can multiply
backend pressure across Netlify isolates and increase lock contention.

### Push performance tests

Cover at least:

- 500 transaction inserts into one account;
- transactions split across several accounts/profiles;
- moving a transaction between accounts;
- transaction and account tombstones;
- CSV batch containing categories, accounts, and transactions;
- two concurrent pushes touching the same account, with lock timeout classified as retryable;
- exact balances after replay and after a lost response.

Record phase timings and SQL statement counts before and after. The goal is fewer round trips and work
proportional to affected accounts/rows, not merely a smaller request body.

---

## 5. Reduce pull fan-out and unnecessary payload

Implement these independently and measure each:

1. **Use `limit + 1`.** Fetch 2,001 for a 2,000-row page, return only 2,000, and set `pending` from the
   extra row. Exact boundaries no longer require an empty discovery request.
2. **Request only pending tables on continuation pages.** The first page requests all synced tables;
   subsequent pages request tables still listed in `pending`. Finish with a small all-table delta sweep
   so reference changes committed during a long transaction pull are not postponed indefinitely.
   Older clients that omit the new field must retain today's all-table behavior.
3. **Fetch colors and rates once per run, plus the final sweep when needed.** Do not repeat the external
   rate call and palette query on every transaction page.
4. **Time the backlog count separately.** Keep it when it is an index-only fast query. If it consumes a
   meaningful portion of the first-page budget, return `null` and show indeterminate progress rather
   than failing the pull.
5. **Evaluate the preliminary profile query.** Compare today's profile-ID read plus `IN (...)` with an
   ownership subquery using production-like `EXPLAIN`. Do not replace an indexed simple plan based on
   statement count alone.
6. **Verify multi-profile ordering.** The pull orders globally by `(updated_at, id)` while indexes begin
   with `profile_id`; verify rather than assume how PostgreSQL handles several profile IDs.

Keep the composite cursor, exact timestamp literal, overlap window, tombstones, and local merge
protection unchanged. They are correctness properties, not performance knobs.

---

## 6. Calibrate count/byte limits and retry behavior

### Count and byte limits

After steps 1–5, benchmark several values on the same staging compute tier:

- push: 50, 100, 250, and 500 mutations;
- pull: 250, 500, 1,000, and 2,000 transactions;
- representative short edits and worst-case comments/names;
- cold and warm Netlify invocations.

Choose the largest limits whose p95 remains inside the request target with headroom. As a conservative
starting point during rollout, use **100 mutations or 256 KiB encoded JSON, whichever comes first**, and
**500 pulled transactions**, but do not make those permanent without measurements.

A byte-aware outbox reader must:

- preserve oldest-first order;
- always make progress for one valid mutation;
- apply both count and encoded-byte ceilings;
- use the same constants in the page and service worker;
- have corresponding server validation;
- never split one mutation.

Add product-appropriate maximum lengths to names and transaction comments so a single row cannot
create an unbounded JSON/SQL payload. Coordinate client and server validation so an existing queued
entry is not turned into a permanently retrying `400` after deployment.

### Retry classification

Current clients retry every non-`401` failure. Change the transport outcome to distinguish:

- **unauthorized:** `401`, transition to login;
- **terminal:** validation/authorization/protocol failures such as `400` and `403`;
- **retryable:** network errors, connection/statement/lock timeout, `408`, `429`, and `5xx`;
- **accepted:** full or explicit partial receipt.

For retryable failures:

- keep the outbox intact;
- use exponential backoff with full jitter;
- respect `Retry-After`;
- reset backoff on `online` and explicit user retry.

For terminal failures, stop hammering the head of the outbox. Mark the entry/batch blocked and show an
actionable error with a safe recovery/export path. Do not silently discard a local write.

### Adaptive splitting

Only consider halving a batch after a **typed execution-budget timeout** proves that row volume caused
the failure. Do not split on connection failures, authentication failures, or arbitrary `502`s. Static,
measured limits are simpler and should be preferred if they meet the target.

---

## 7. Validation, rollout, and rollback

### Local validation

Run focused checks for the changed modules first:

- push execution and mutation tests;
- outbox acceptance and sync-run tests;
- cross-user authorization tests;
- balance derivation/recomputation tests;
- route tests for `/api/push` status classification;
- typecheck after protocol changes;
- generated migration verification.

Run `pnpm db:generate` and then `pnpm db:migrate` for the receipt table. Never edit generated migration
metadata manually and never use `drizzle-kit push`.

### Staging matrix

Use a non-production Supabase project or branch on the same compute class and region shape as
production. Test:

| Scenario                              | Expected result                                                  |
| ------------------------------------- | ---------------------------------------------------------------- |
| cold pull, empty local database       | pages converge; every request stays within budget                |
| warm delta pull                       | one short request, no repeated rates/palette work                |
| 10,000-row import                     | sequential bounded pushes; outbox drains; balances remain exact  |
| connection unavailable                | controlled retryable error before budget; UI remains local-first |
| query forced beyond statement timeout | `503`, transaction rollback, outbox retained                     |
| lock contention                       | short retryable lock timeout, not a 30–60 second wait            |
| response lost after commit            | retry is receipt-only; no second write/timestamp/conflict        |
| service worker and page race          | one accepted result per mutation; duplicate delivery harmless    |
| cross-user UUID collision             | no foreign update, confirmation, or canonical row                |
| rates provider stalled                | pull succeeds with cached/null rates                             |

### Production rollout

1. verify whether the deployed `5432` endpoint is actually session or project-specific transaction mode,
   and record SSL state;
2. deploy the implemented logs/deadlines/currency timeout/`prepare: false` changes to a Deploy Preview or
   canary without changing host or port;
3. exercise one pull, one small push, and one service-worker push; verify phase completion, controlled
   timeout classification, and `transactions-tracker-runtime` in `pg_stat_activity` where visible;
4. canary any corrected production connection topology and compare cold/warm connection and SQL phase
   timing;
5. deploy mutation `RETURNING`, receipts, and the generated migration;
6. deploy push query optimization;
7. measure for at least one normal sync cycle and one representative import;
8. tune pull and batch limits;
9. update `docs/architecture.md` with proven budgets and connection modes.

Watch:

- `502`/`503` rates by operation;
- p50/p95/p99 total and phase duration;
- outbox age and count;
- retry and duplicate-receipt rate;
- Supabase CPU, backend connections, pooler clients, lock waits, and slow queries;
- Netlify invocation duration and cold starts.

### Rollback

- Keep the previous runtime endpoint values available as a controlled rollback, but never roll back to
  transaction pooling with prepared statements enabled.
- Connection-mode and timeout changes are independently reversible through deployment configuration.
- Query optimizations should preserve the response interface or be deployed with backward-compatible
  optional fields so an old service worker continues to work.
- The receipt table is additive. If application code is rolled back, leave the table in place rather
  than running a destructive down migration during an incident.
- Batch limits must be compatible across the currently active page, service worker, and server deploy.
  Prefer a server that accepts both old and new client limits during the rollout window.

## Why not a background function first?

A Netlify background function returns before work finishes, but this sync protocol needs an acceptance
receipt, canonical server timestamps, conflict information, and deterministic outbox removal. Moving
pushes to the background would require:

- a durable server-side queue independent of the slow database;
- a job/idempotency record;
- polling or push notification for completion;
- a new protocol for canonical rows and conflicts;
- handling Netlify's much smaller background payload limit;
- recovery when enqueue succeeds but acknowledgement is lost.

The browser's IndexedDB outbox is already a durable queue and works offline. Making the normal database
request fast, fail-fast, and idempotent is a much smaller and deeper change.

Escalate to a server-side queue or a sync worker co-located with Supabase only if, after connection and
query fixes, a required atomic batch still cannot meet the eight-second application budget. At that
point compare:

1. a Supabase-co-located worker/Edge Function with the existing custom authentication bridged safely;
2. a dedicated queue plus worker and job-status endpoint;
3. upgrading or moving the PostgreSQL instance;
4. moving the TanStack server runtime nearer the database.

A database connection that takes 30 seconds for trivial work is infrastructure failure, not a payload
format problem; fix or replace that infrastructure before building an asynchronous sync subsystem
around it.

## Official references

- [Netlify Function configuration and limits](https://docs.netlify.com/build/functions/optional-configuration/)
  — synchronous limit, payload limits, and Functions regions.
- [Netlify Function logs](https://docs.netlify.com/build/functions/logs/)
  — invocation/request IDs, historical logs, and retention limits.
- [Supabase: Connect to your database](https://supabase.com/docs/guides/database/connecting-to-postgres)
  — direct/session/transaction modes, serverless recommendation, IPv4/IPv6 behavior, port `6543`,
  and the requirement to disable prepared statements in transaction mode.
- [Supabase Postgres SSL enforcement](https://supabase.com/docs/guides/platform/ssl-enforcement)
  — encryption and `verify-full` guidance.
