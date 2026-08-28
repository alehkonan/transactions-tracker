# Session & Passkey Management Plan

Add multi-device session visibility and passkey management to `/settings` while keeping sessions and
credentials server-owned rather than part of the offline-first replicated working set. Read
`docs/architecture.md` first — the auth and storage constraints below come from there.

## Multi-device session management on `/settings`

- [ ] Schema: `sessions.userAgent`, `sessions.lastUsedAt`, and nullable-for-legacy `sessions.credentialId`
- [ ] Server functions: `listSessions`, `revokeSession`, `listPasskeys`, `revokePasskey` (+ optional `signOutOtherSessions`)
- [ ] UI: `SessionsCard` + `PasskeysCard` sections on `/settings`

### What exists today

`sessions` (`src/database/tables.ts`) holds only `refreshTokenHash` and `refreshTokenExpiresAt` —
there is nothing to show a user: no device identity, no last-active, no link to the passkey that
opened it. `credentials` is richer (`deviceType`, `backedUp`, `transports`, `lastUsedAt`, already
updated on every sign-in). `/settings` currently shows the username from the hint cookie, sign-out,
profile, categories, import/export and the integrity check. `session.server.ts` has `createSession`
/ `destroySession` / `resolveSession`; revoking is a single `DELETE` that takes effect when the
target device's stateless access cookie next expires — up to an hour. That latency is a known,
accepted cost (architecture.md, "Auth"), and this work's job is to surface it, not fix it.

### Schema changes

In `src/database/tables.ts`, then `pnpm db:generate` followed by `pnpm db:migrate` (never
`drizzle-kit push`):

- `sessions.userAgent text` — raw User-Agent captured at sign-in. Existing rows get `null`; the UI
  renders "Unknown device". This is display metadata, not an authorization signal.
- `sessions.lastUsedAt timestamptz` — set to `new Date()` when the session is created and updated by
  `resolveSession` on the refresh path (once an hour per active device), so "last active" is honest
  without a write per request. Existing rows remain `null` and must sort after dated rows.
- **Required for this item:** `sessions.credentialId text` referencing `credentials(id)` (nullable
  only for existing sessions created before this migration). It lets "revoke passkey" also delete the
  sessions that passkey opened, and lets the UI say "Chrome on macOS · signed in with a passkey".
  `signIn` already knows the credential (`record.credential.id`); `signUp` knows it from the
  attestation. Thread it through `createSession` and explicitly define the foreign-key delete action
  or delete dependent sessions first in the same transaction.

The migration is purely additive; no backfill. Include the generated SQL migration and Drizzle
metadata/journal changes in the deliverables. New sessions must always carry the credential that
opened them; legacy `NULL` associations are displayed as unknown and cannot be retroactively inferred.

### Server functions

All in `src/api/auth.functions.ts` — the auth domain file, per the repo's placement rules — each
composed `.middleware([loggerMiddleware, authMiddleware])`, GET reads and POST mutations, Zod
validators on the inputs:

- `listSessions` (GET) — the caller's sessions, newest `lastUsedAt` first, with `NULLS LAST` and a
  deterministic `createdAt` tie-breaker:
  `{ id, createdAt, lastUsedAt, userAgent, expiresAt, isCurrent }`. For `isCurrent`, export a small
  `getCurrentSessionId()` from `session.server.ts` (it already parses the access cookie in
  `destroySession`; same `verifyCookieValue` read, without checking the expiry — an expired access
  cookie still names the session the caller is on).
- `revokeSession` (POST, `{ sessionId }`) — `delete ... where id = X and userId = context.user.id`;
  the ownership predicate belongs in the `WHERE`, not in a pre-check. Revoking the _current_
  session should behave like sign-out: delegate to `destroySession()` in that branch, and have the
  client reset local data and invalidate/navigate to `/login`, because anything else strands the user
  on a page that resolves to nothing. The UI must explain that an already-issued access cookie can
  remain accepted for up to an hour.
- `listPasskeys` (GET) — `{ id, createdAt, lastUsedAt, deviceType, backedUp, isLast }`. No public
  keys over the wire.
- `revokePasskey` (POST, `{ credentialId }`) — ownership-scoped delete with one hard guard:
  **refuse to remove the last remaining credential.** This app has no password fallback and no
  recovery path; losing every authenticator loses the account, and the UI must not be the thing
  that causes it. The count/check/delete must be atomic: lock the user row (or use an equivalent
  database-level guard) inside a transaction, count credentials, then delete the credential and its
  associated sessions in that same transaction. If the revoked credential opened the current session,
  the client must handle the resulting sign-out consistently; an already-issued access cookie may
  still live until its normal expiry.
- Optional: `signOutOtherSessions` (POST) — one click for "I left myself logged in on a shared
  machine".

`createSession` grows an options argument — `createSession(user, { userAgent, credentialId })` —
with the User-Agent read in the handler from the request. Verify the exact request-access API against
the installed TanStack Start version (`webauthn.server.ts`'s `getRequestUrl()` is the in-repo
precedent). The server must not accept a credential belonging to another user when associating it
with a session; the known `signUp`/`signIn` records should be the source of that association.

### UI

`src/modules/auth/`, one component per file, matching the settings page's existing card/section
rhythm. This is **server-owned data, never replicated** — it must not go anywhere near the sync
store; fetch on demand through the server functions, the way the `IntegrityCheck` panel already
does on this page.

- `SessionsCard.tsx` — one row per session: a friendly device label, "This device" badge when
  `isCurrent`, created / last-active dates (`date-fns`), a Revoke button with a confirm step (the
  existing `Dialog`). Footnote, stated plainly: "Revoking signs a device out when its access token
  expires — within the hour."
- `PasskeysCard.tsx` — one row per credential: device type, "Synced to your passkey provider" when
  `backedUp`, added / last-used dates, Revoke — disabled with an explanation when `isLast`.
- A small hook (`useSessions.ts` / `usePasskeys.ts`, or one `useSessionManagement.ts`) that fetches
  on mount and refetches after a revoke; loading, empty, offline/error, retry, and unauthorized
  states. TanStack Start may return a raw `Response` when `authMiddleware` rejects, so use the same
  response-unwrapping approach as `usePasskeyAuth.ts` and navigate through the normal sign-out path
  when the session has expired.
- `describe-user-agent.ts` — hand-rolled UA → "Chrome on macOS" parsing with the raw string as
  fallback. No new dependency for this.
- Wire both into `settings.tsx` as "Sessions" and "Passkeys" sections between User and Profile. No
  new routes, so no `pnpm generate-routes`.

### Verification

`pnpm db:generate` produces one additive migration plus the expected Drizzle metadata/journal
updates; `pnpm db:migrate` applies it; typecheck, unit tests and `pnpm knip` stay green (every new
export consumed). Add server-side tests for ownership scoping, the last-credential guard including
concurrent revocation, current-session behavior, legacy `NULL` associations, and `lastUsedAt` on
creation/refresh. Manual pass: sign in on two browsers, revoke the other one, and confirm its refresh
fails — testable immediately by clearing that browser's `access_token` cookie, or by waiting out the
hour. Also verify that revoking the current session/passkey resets local state and returns to `/login`.
Lefthook runs the rest on push.
