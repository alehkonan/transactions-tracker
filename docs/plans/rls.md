# Row-Level Security Plan

Add PostgreSQL Row-Level Security (RLS) as a second authorization boundary for user-owned
profiles, accounts, categories, and transactions. The existing server-side ownership checks remain
required: RLS protects database access from missed predicates, but it does not authenticate a caller
or make a database role trustworthy by itself.

Read [`docs/architecture.md`](../architecture.md) first. This work must preserve the offline-first
contract: the browser still reads from IndexedDB/Zustand, writes locally first, and uses the three
sync endpoints as the only data surface.

**No dependency is required.** The work uses PostgreSQL policies, Drizzle migrations, the existing
`postgres-js` driver, and the existing authenticated `context.user.id`.

| #   | Step                                    | Lands as                                                                           | Main files                                                                                      | Risk                  |
| --- | --------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------- |
| 1   | Audit ownership and role assumptions    | A read-only database audit and deployment decision                                 | `docs/plans/rls.md`, deployment configuration                                                   | medium                |
| 2   | Make ownership invariants explicit      | Backfill/constraint migration for ownership and transaction relationships          | `src/database/tables.ts`, `src/database/migrations/`                                            | high (data migration) |
| 3   | Add transaction-scoped RLS context      | A server-only helper that sets `app.user_id` with `SET LOCAL`                      | new `src/api/rls-context.server.ts`                                                             | medium                |
| 4   | Wrap protected database work            | Every protected read/write runs with the authenticated context                     | `src/api/sync.functions.ts`, `profile.functions.ts`, `auth.functions.ts`                        | high (sync path)      |
| 5   | Add RLS policies                        | Policies for the four user-owned tables, with `USING` and `WITH CHECK`             | `src/database/migrations/`                                                                      | high (authorization)  |
| 6   | Separate runtime and maintenance access | Runtime role cannot bypass RLS; migrations/GC retain administrative access         | `get-db.server.ts`, `drizzle.config.ts`, `netlify/functions/tombstone-gc.ts`, deployment config | high (operations)     |
| 7   | Test isolation and rollout              | Cross-user tests, migration verification, staged deployment and rollback procedure | `e2e/`, `src/api/`, `docs/architecture.md` if behavior changes                                  | high                  |

Suggested order: **1 → 2 → 3 → 4 → 5 → 6 → 7**. Do not enable policies before the application
can set the context on every protected query and the existing data has passed the ownership audit.

---

## 1. Audit the data and database roles

- [ ] Confirm which database role runs the application.
- [ ] Confirm which role owns the tables and whether either role has `BYPASSRLS` or superuser rights.
- [ ] Provision or identify a separate migration/owner role and a runtime role without `BYPASSRLS`.
- [ ] Run the following read-only audit against a backup or staging database first.

```sql
-- Ownership roots that cannot be safely scoped yet.
SELECT count(*) AS unowned_profiles
FROM profiles
WHERE user_id IS NULL;

SELECT count(*) AS unowned_accounts
FROM accounts
WHERE profile_id IS NULL;

SELECT count(*) AS unowned_categories
FROM categories
WHERE profile_id IS NULL;

-- Denormalized relationship checks.
SELECT count(*) AS transactions_with_wrong_account_profile
FROM transactions AS t
JOIN accounts AS a ON a.id = t.account_id
WHERE t.profile_id <> a.profile_id;

SELECT count(*) AS transactions_with_wrong_category_profile
FROM transactions AS t
JOIN categories AS c ON c.id = t.category_id
WHERE t.profile_id <> c.profile_id;

-- Rows that are structurally valid by FK but may be inaccessible after RLS.
SELECT count(*) AS transactions_without_account
FROM transactions
WHERE account_id IS NULL;
```

The last query is informational rather than an error: transactions may legitimately have no account.
The first three queries must be resolved before policies are enabled. A `NULL` ownership value must
not become a policy shortcut that exposes shared legacy data to every authenticated user.

### Role decision

The current environment uses `POSTGRES_USER` for the application and Drizzle commands. If that role
owns the tables, it can bypass ordinary RLS. The preferred production arrangement is:

- **Migration/owner role** — owns tables and runs `pnpm db:migrate`; not used by request handlers.
- **Runtime role** — used by `getDb()` and the scheduled application functions; has only the required
  DML privileges and does not have `BYPASSRLS`.
- **Maintenance role** — used by tombstone GC, or an explicitly controlled administrative path.

Do not put a secret in source control or hardcode credentials. Add deployment variables only after the
role names and provider support are confirmed.

---

## 2. Make ownership and relationship invariants explicit

- [ ] Decide how to assign existing `profiles.user_id IS NULL` rows. Preserve the current first-user
      adoption behavior only as a one-time migration decision; do not leave an RLS-visible shared pool.
- [ ] Assign or remove accounts/categories with `NULL profile_id`.
- [ ] Verify all transactions have a valid `profile_id` as the schema already requires.
- [ ] Resolve any transaction/account or transaction/category profile mismatches.
- [ ] Update `src/database/tables.ts` so `profiles.userId`, `accounts.profileId`, and
      `categories.profileId` are `.notNull()` once the data is clean.
- [ ] Add database-level protection for transaction relationships. Prefer composite foreign keys from
      `(transactions.account_id, transactions.profile_id)` to `(accounts.id, accounts.profile_id)` and
      from `(transactions.category_id, transactions.profile_id)` to
      `(categories.id, categories.profile_id)`, while retaining the nullable category/account behavior.
      If the composite constraints are impractical for this migration, the transaction RLS policy must
      enforce the same-profile checks instead.
- [ ] Generate the schema migration with `pnpm db:generate`, review it, then apply it with
      `pnpm db:migrate`. Never use `drizzle-kit push`.

The migration must be staged so that a failed audit prevents the `NOT NULL` and foreign-key changes
from being applied. Take a backup before the first production migration and record row counts before
and after it.

### Why the relationship check matters

`transactions.profile_id` is deliberately denormalized for indexed sync pulls. Without a composite
constraint or an equivalent policy check, a transaction could claim one profile while referencing an
account or category belonging to another profile. Application checks currently prevent this in
`src/api/ownership.server.ts`; RLS should not weaken that guarantee for direct SQL paths.

---

## 3. Add a transaction-scoped RLS context

- [ ] Add `src/api/rls-context.server.ts` as a server-only helper.
- [ ] Accept the existing `Executor` type from `src/database/get-db.server.ts`.
- [ ] Set the user ID with a bound parameter and transaction-local scope:

```ts
await tx.execute(sql`select set_config('app.user_id', ${String(userId)}, true)`);
```

- [ ] Provide a helper that opens a transaction, sets the context, and invokes a callback with the
      transaction executor.
- [ ] Never use a connection-level `SET app.user_id` on the shared `getDb()` connection. The driver
      uses pooling and a connection can serve another request after the current query completes.
- [ ] Keep the existing application ownership predicates. RLS is defense in depth, not a replacement
      for the checks that return deliberate 403 responses.

The context must be initialized after `authMiddleware` has resolved `context.user.id`. An absent or
invalid context must result in no rows being visible and no user-owned rows being writable.

---

## 4. Put every protected query inside the context boundary

### Sync reads

Update `src/api/sync.functions.ts` so the following execute in one RLS-context transaction per
request:

- `pullChanges`, including the profile lookup, four paginated queries, transaction backlog, and any
  protected aggregates.
- `checkIntegrity` and all four table aggregates.
- `readCanonicalRows` after a push.

The current offline-first response shape and cursor behavior must not change. Tombstones must remain
visible to the owning user during delta pulls; RLS should scope by ownership, not by
`deleted_at IS NULL`.

`colors` is global and can remain outside the user-owned policies. It must still be accessed only by
server code.

### Sync writes

Update `pushChanges` so the mutation transaction sets `app.user_id` before calling
`applyMutations`. Keep the existing transaction atomicity: a rejected row must roll back the whole
batch. The canonical-row read must run in a context-aware transaction as well, or be performed before
the mutation transaction is released while preserving the current response contract.

The following existing checks must remain:

- `assertProfilesOwnedBy`
- `assertAccountsInProfile`
- `assertCategoriesInProfile`
- `setWhere` guards on conflict updates
- explicit tombstoning of child rows

### Other protected paths

- Update `src/api/profile.functions.ts` so `selectProfile` runs with the caller's RLS context.
- Update the first-sign-up path in `src/api/auth.functions.ts` if it still modifies legacy unowned
  profiles. That path must either complete before RLS is enabled or establish the newly-created user's
  context inside the same transaction.
- Leave authentication tables (`users`, `credentials`, `sessions`, and
  `webauthn_challenges`) outside these user-data policies. Anonymous WebAuthn ceremonies and session
  resolution must continue to work before a user context exists.

Review every new database query added after this work. Any query touching `profiles`, `accounts`,
`categories`, or `transactions` must either run in an RLS context or be an explicitly controlled
maintenance operation.

---

## 5. Add the RLS migration and policies

RLS policies are PostgreSQL security objects and are not expected to be fully represented by the
current Drizzle table definitions. Add them in a reviewed SQL migration after the schema/data
migration. Do not rely on `drizzle-kit generate` to infer policy changes.

### Context function

Create a small, read-only helper such as `public.current_app_user_id()` that reads
`current_setting('app.user_id', true)` and returns an integer or `NULL` when no context is set. Keep
it narrowly scoped and do not make it a general-purpose authorization function.

### Policies

Enable and force RLS on:

```text
profiles
accounts
categories
transactions
```

Each policy needs both:

- `USING` — filters rows visible to `SELECT`, `UPDATE`, and `DELETE`.
- `WITH CHECK` — validates rows introduced by `INSERT` and new values from `UPDATE`.

The policy rules are:

1. A profile is accessible only when `profiles.user_id` equals the current application user.
2. An account or category is accessible only when its `profile_id` belongs to a profile owned by the
   current application user.
3. A transaction is accessible only when its `profile_id` belongs to an owned profile.
4. A transaction's non-null account and category references must belong to that same profile. This is
   required even if composite foreign keys are added, because the policy should make the authorization
   boundary obvious.
5. Do not filter tombstones in RLS. The sync protocol needs an owner to receive deletion rows.
6. Do not add a policy that treats `NULL user_id` or `NULL profile_id` as public/shared data.

Use explicit policy names, for example:

```text
profiles_owner_select_write
accounts_owner_select_write
categories_owner_select_write
transactions_owner_select_write
```

Before production rollout, verify the behavior of `INSERT ... ON CONFLICT DO UPDATE`: a guessed UUID
from another user's row must not update or reveal that row, and a row created earlier in the same push
transaction must be available to later dependent mutations.

### FORCE RLS and owners

Use `FORCE ROW LEVEL SECURITY` only with a role/deployment plan that keeps migrations and maintenance
working. The runtime role must not be the table owner and must not have `BYPASSRLS`. If the provider
cannot provide that separation, document the limitation: RLS will not protect queries executed by the
owner/superuser, and application-level authorization remains the effective boundary.

---

## 6. Adapt maintenance and deployment operations

- [ ] Update `getDb()` configuration so request handlers use the runtime role.
- [ ] Update `drizzle.config.ts` and the deployment migration job to use the migration role.
- [ ] Update `netlify/functions/tombstone-gc.ts` to use the maintenance role or a controlled
      administrative connection. GC deletes tombstones across all users and cannot run with a normal
      user's `app.user_id`.
- [ ] Ensure backups, local Docker setup, staging, and production use the same role semantics.
- [ ] Document which role may run `pnpm db:migrate` and `pnpm gc:tombstones`.
- [ ] Confirm connection pooling does not retain one request's `app.user_id` for the next request.

Do not solve maintenance access by allowing the runtime request role to set an unrestricted
`app.maintenance` bypass flag. That would turn an application bug into a complete RLS bypass.

---

## 7. Test the isolation boundary

### Database-level tests

Against a disposable staging database, create two users with separate profiles and data. For each
protected table, verify:

- user A can select their own rows;
- user A cannot select user B's rows, even when it knows their UUID;
- user A cannot update or tombstone user B's rows;
- user A cannot insert an account/category/transaction under user B's profile;
- user A cannot insert a transaction under their profile that references user B's account/category;
- an unset `app.user_id` sees no user-owned rows;
- a row created earlier in the same transaction is available to dependent inserts;
- tombstones are visible to the owner and invisible to other users;
- `colors` remains globally readable only through server paths.

Use the runtime role for these assertions. Testing as the table owner would falsely pass because the
owner may bypass RLS.

### Application tests

- [ ] Add an integration/e2e case that signs in as two users and confirms the first user's sync payload
      contains no second-user rows.
- [ ] Attempt forged UUID mutations through `pushChanges` and assert the existing 403/empty-update
      behavior remains intact.
- [ ] Test profile creation followed by account and transaction creation in one pushed batch.
- [ ] Test `pullChanges`, `checkIntegrity`, `selectProfile`, and canonical-row reads with a missing or
      expired context.
- [ ] Run the existing unit and e2e suites after the RLS-specific tests.

### Verification commands

Run the narrow checks first, then the normal project checks:

```bash
pnpm db:migrate
pnpm typecheck
pnpm test:unit
pnpm test:e2e
pnpm build
```

Do not run destructive database cleanup against a shared development or production database as part
of these checks.

---

## Rollout and rollback

### Staged rollout

1. Apply the audit queries to staging and record ownership/mismatch counts.
2. Apply data cleanup and constraint changes to staging.
3. Deploy the context-aware application code while policies are still disabled; confirm sync behavior.
4. Apply the RLS policies in staging and run the isolation suite with the runtime role.
5. Monitor pull/push errors, 401/403 responses, and database policy violations.
6. Repeat the same sequence in production during a controlled deployment window.

### Rollback

Keep a migration that can disable the four policies if the rollout blocks legitimate traffic:

```sql
ALTER TABLE profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE accounts DISABLE ROW LEVEL SECURITY;
ALTER TABLE categories DISABLE ROW LEVEL SECURITY;
ALTER TABLE transactions DISABLE ROW LEVEL SECURITY;
```

Use this only as an emergency operational rollback. Do not revert the ownership data migration without
a backup-aware procedure, because reverting `NOT NULL` or composite relationship constraints can
reintroduce rows that the application cannot safely scope.

---

## Out of scope

- Moving authentication into PostgreSQL.
- Exposing PostgreSQL directly to browsers.
- Replacing the existing ownership checks with policies alone.
- RLS on global `colors` or authentication tables.
- Changing the offline-first replication scope or selected-profile behavior.
- Granting users access to another user's profiles, even if a future sharing feature is added; that
  would require an explicit membership model and new policies rather than weakening ownership rules.

## Definition of done

- [ ] No unowned user-data rows remain, or they are explicitly excluded from the application.
- [ ] Ownership columns and transaction relationships are enforced by the schema/policies.
- [ ] Every protected request query sets a transaction-local authenticated user context.
- [ ] Runtime access uses a role that cannot bypass RLS.
- [ ] Auth, migrations, and tombstone GC continue to work through their separate administrative paths.
- [ ] Cross-user isolation and same-profile relationship tests pass.
- [ ] The offline-first sync contract remains unchanged and the architecture documentation reflects any
      transaction-boundary changes.
