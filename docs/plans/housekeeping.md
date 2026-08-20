# Housekeeping & Infrastructure Plan

The four items from the original checklist, turned into execution plans: the current state, the
design decisions, the exact files to touch, and how to verify each one landed. Read
`docs/architecture.md` first — every constraint below (offline-first reads, server-only database
access, generated migrations, semantic tokens) comes from there.

**Nothing here adds a dependency.** Playwright, drizzle-kit, Tailwind v4, Zod and the
SimpleWebAuthn stack are already installed and configured; the work is wiring them into the places
the checklist names.

| #   | Item                         | Lands as                                                      | Touches                                                               | Risk                        |
| --- | ---------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------- |
| 1   | E2E specs                    | `e2e/` — three specs + fixtures                               | `playwright.config.ts`                                                | low (test-only)             |
| 2   | Session & passkey management | new schema columns, five server functions, two settings cards | `tables.ts`, `auth.functions.ts`, `session.server.ts`, `settings.tsx` | medium (additive migration) |
| 3   | Shared tombstone table list  | one import-free module + invariant test                       | `synced-tables.ts` (new), `sync-types.ts`, `tombstone-gc.ts`          | very low                    |
| 4   | Dark-mode theme file         | `src/styles/dark.css` + tokens replacing inline `dark:`       | `styles.css`, four component files                                    | low                         |

Suggested order: **3 → 1 → 2 → 4**. Item 3 is half an hour and removes a footgun the other work
could trip over; item 1 locks in today's boot/sync behavior before item 2 changes the auth surface.

---

## 1. E2E specs for the paths unit tests cannot reach

- [ ] `e2e/boot-gate.spec.ts` — first run, returning visit, offline reload, dead-session-with-live-hint
- [ ] `e2e/two-tab-sync.spec.ts` — a write in one tab appears in the other without a reload
- [ ] `e2e/offline-write.spec.ts` — a write made offline queues, then pushes on reconnect
- [ ] `e2e/fixtures/auth.ts` + `e2e/global-setup.ts`, and the `playwright.config.ts` additions

### What exists today

`playwright.config.ts` is fully configured — `testDir: "./e2e"` (the directory does not exist yet),
`baseURL: http://localhost:5454`, a `webServer` running `pnpm dev` with `reuseExistingServer:
!process.env.CI`, three browser projects (chromium / firefox / webkit), `trace: "on-first-retry"`.
`pnpm test:e2e` is wired in `package.json`. The 77 unit tests (10 files) cover pure functions only:
the derivations, the import planner, the integrity digest. Nothing exercises IndexedDB,
`BroadcastChannel`, Web Locks, the boot gate, or a real server-function round trip.

The specs assert against three behaviors the architecture doc already describes precisely, so the
assertions can be written from the doc rather than invented:

- **The boot gate** (`SyncGate.tsx`): the app stays behind "Loading your data…" until the reference
  tables (`profiles`, `accounts`, `categories`) arrive; a populated IndexedDB hydrates in ~50ms
  with no network; an unauthorized pull navigates to `/login`.
- **Cross-tab visibility** (`sync-engine.ts`): a write is on disk before it is in memory, and
  `announceLocalWrite()` tells peers over `BroadcastChannel("transactions-tracker:sync")` to re-read
  (debounced 300ms) — "a queued write is visible to every tab the moment it is on disk".
- **Offline write** (`SyncStatus.tsx`): the write path is local-first; the status indicator is the
  contract ("Offline — 1 change saved on this device…", later "Everything on this device is on the
  server").

### The auth problem, and the answer

Every route except `/login` sits behind passkey auth, so the first problem is performing the WebAuthn
ceremony in a test browser. Playwright has no built-in WebAuthn API, but Chromium exposes a virtual
authenticator over CDP that auto-approves `navigator.credentials.create()/get()` with no dialog:

```ts
// e2e/fixtures/auth.ts
const cdp = await context.newCDPSession(page);
await cdp.send("WebAuthn.enable");
await cdp.send("WebAuthn.addVirtualAuthenticator", {
  protocol: "ctap2",
  transport: "internal",
  hasResidentKey: true, // signUp demands a discoverable credential (residentKey: "required")
  hasUserVerification: true,
  isUserVerified: true,
});
```

Each test gets a fresh context and therefore an authenticator holding exactly one credential, which
matters because `getSignInOptions` deliberately omits `allowCredentials` — with one discoverable
credential on the virtual authenticator, sign-in resolves without an account chooser.

**Trade-off to accept explicitly:** the virtual authenticator is CDP, so these specs are
Chromium-only. Keep the firefox/webkit projects in the config (they simply run zero tests today) and
gate the specs with `test.skip(({ browserName }) => browserName !== "chromium", "needs the CDP
virtual authenticator")`. If cross-browser coverage is ever wanted, the documented escape hatch is
to mint the signed access cookie inside the test harness — it is stateless, HMAC-SHA256'd with
`AUTH_SECRET`, and `resolveSession()` verifies it with no query — or a dev-only session-minting
server function. Neither is built by this item; the three specs target IndexedDB/BroadcastChannel/
Web Locks behavior, and the passkey ceremony is not what they are about.

### Test database and isolation

- The specs run against the dev Postgres (`docker compose up -d db`, `.env` from `.env.example`)
  with migrations applied. Add `e2e/global-setup.ts` that runs `pnpm db:migrate` via `execSync`
  (drizzle-kit migrate is idempotent — it no-ops when nothing is pending) and fails fast with
  "start the database first: docker compose up -d db" when it cannot connect. Point `globalSetup`
  at it from `playwright.config.ts`. The `webServer` starts before global-setup; Vite boots without
  the database, so the order is fine.
- **Isolation by construction, not by cleanup:** every spec signs up its own user with a unique
  username (`e2e-<spec>-${test.info().workerIndex}-${Date.now()}`). `fullyParallel: true` stays
  safe because no spec reads another spec's rows. Do not truncate between tests — parallel workers
  would race each other. Dev databases accumulate `e2e-*` users; an occasional manual
  `delete from users where username like 'e2e-%'` (FK cascades do the rest) is enough.
- **Selectors:** accessible names only — the UI already exposes the ones needed (`aria-label="Add
account"`, `aria-label="Add transaction"`, the sync indicator's `aria-label`). Prefer adding an
  `aria-label` over a `data-testid` where a name is missing. Assert what is on screen, never store
  internals.

One selector subtlety worth writing into the fixtures: the sync indicator's visible label is
viewport-dependent (`md:hidden` on the strip text), so assert against its `aria-label` —
`getByRole("button", { name: "Synced" })` — which is stable at every size.

### The fixtures (`e2e/fixtures/auth.ts`)

Extend `test` with a `signedInPage` fixture that performs the full human onboarding once, through
the UI:

1. enable the virtual authenticator (above);
2. on `/login`, fill "Username" and click **Create a passkey** — the ceremony auto-approves,
   `signUp` runs, cookies land;
3. the root guard's profile check redirects to `/profile` — create a profile via the
   **Create profile** dialog and select it (the `selectProfile` call sets the profile cookies);
4. on `/accounts`, click **Add account** and create one — a transaction cannot exist without an
   account, and the transactions form needs one to pick.

Return the page. A second helper, `contextWithStaleHints`, copies only the non-`httpOnly` cookies
(`session_hint` and the profile hint) from an authenticated context into a fresh one — that is the
forgeable-hint path the route guards knowingly trust.

### Spec 1 — the boot gate

- **First run:** through `signedInPage`, assert the loading screen ("Loading your data…") is
  eventually replaced by app chrome, and the created account is visible on `/`. This is
  `isHydrated` flipping once the reference tables complete.
- **Returning visit:** `page.reload()` — the account is visible again, from IndexedDB, without
  waiting on the network.
- **Offline reload:** `context.setOffline(true)` → `page.reload()` — the app still opens and shows
  the data. The pull fails _behind_ the hydrated UI; the spec must assert the data is visible and
  the "Could not load your data" screen never appears (that screen only renders when
  `isHydrated` is false).
- **Dead session, live hint:** a `contextWithStaleHints` context navigates to `/` — the guards let
  it in, the boot pull 401s, the store goes `unauthorized`, and `SyncGate` lands it on `/login`.
  This is the exact scenario the SyncGate comment names: "the server rejecting the pull is the
  first real proof that the session is gone."

### Spec 2 — two-tab sync

One context, two pages (same cookies, same IndexedDB, same BroadcastChannel — exactly the sharing
model the engine is written against):

1. page A: full `signedInPage` setup; page B: `context.newPage()` → `/` — it hydrates from the
   IndexedDB A's pull populated, so it is fast;
2. navigate both to `/transactions`;
3. in A: **Add transaction** → fill the form (type, amount, the account) → save;
4. assert the transaction appears in A, then — with no reload in B — appears in B too, inside a
   generous timeout (`toBeVisible({ timeout: 10_000 })`; the peer message is debounced 300ms, the
   push debounce is 1s).

One direction, one write, deterministic. Optionally assert B's indicator settles on "Synced"
afterwards (A's push and B's own pull both converge) — cheap, and it exercises the second
half of the contract.

### Spec 3 — an offline write that pushes on reconnect

1. `signedInPage` setup, then wait for the indicator to read "Synced" — the baseline matters, or
   the spec cannot tell a queued write from a slow first pull;
2. `context.setOffline(true)` — `navigator.onLine` flips and the engine records it;
3. create a transaction through the UI; assert it renders immediately (local-first) and the
   indicator reports the queued state — `aria-label` containing "saved on this device, waiting for
   a connection". The 1s push debounce fires into offline failure and backs off (max 30s); the
   write must survive all of that;
4. `context.setOffline(false)` — the `online` event resets the backoff and calls `syncNow`;
   assert the indicator returns to "Synced" ("Everything on this device is on the server.");
5. prove the round trip: `page.reload()` — a fresh boot pulls from the server with an empty
   outbox, and the transaction is still there. This is the strongest claim the spec can make.

### Out of scope (deliberately)

Visual regression, the mobile viewport matrix, the CSV import flow, statistics, and any spec for
the settings page. The three specs the checklist names are the ones guarding the offline-first
contract; everything else can layer on the fixtures above once they exist.

### Verification

`docker compose up -d db && pnpm db:migrate && pnpm test:e2e`, run **twice in a row** — the second
run proves no state leaked from the first. `pnpm typecheck` covers `e2e/` already (`tsconfig`
includes `**/*.ts`); if `pnpm knip` flags the new entry files, add `e2e/**/*.ts` to its entry
patterns.

---

## 2. Multi-device session management on `/settings`

- [ ] Schema: `sessions.userAgent`, `sessions.lastUsedAt`, optionally `sessions.credentialId`
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
  renders "Unknown device".
- `sessions.lastUsedAt timestamptz` — set by `resolveSession` on the refresh path (once an hour per
  active device), so "last active" is honest without a write per request.
- **Recommended:** `sessions.credentialId text` referencing `credentials(id)` (nullable). It lets
  "revoke passkey" also delete the sessions that passkey opened, and lets the UI say "Chrome on
  macOS · signed in with a passkey". `signIn` already knows the credential (`record.credential.id`);
  `signUp` knows it from the attestation. Thread it through `createSession`.

The migration is purely additive; no backfill.

### Server functions

All in `src/api/auth.functions.ts` — the auth domain file, per the repo's placement rules — each
composed `.middleware([loggerMiddleware, authMiddleware])`, GET reads and POST mutations, Zod
validators on the inputs:

- `listSessions` (GET) — the caller's sessions, newest `lastUsedAt` first:
  `{ id, createdAt, lastUsedAt, userAgent, expiresAt, isCurrent }`. For `isCurrent`, export a small
  `getCurrentSessionId()` from `session.server.ts` (it already parses the access cookie in
  `destroySession`; same `verifyCookieValue` read, without checking the expiry — an expired access
  cookie still names the session the caller is on).
- `revokeSession` (POST, `{ sessionId }`) — `delete ... where id = X and userId = context.user.id`;
  the ownership predicate belongs in the `WHERE`, not in a pre-check. Revoking the _current_
  session should behave like sign-out: delegate to `destroySession()` in that branch, because
  users will click it and anything else strands them on a page that resolves to nothing.
- `listPasskeys` (GET) — `{ id, createdAt, lastUsedAt, deviceType, backedUp, isLast }`. No public
  keys over the wire.
- `revokePasskey` (POST, `{ credentialId }`) — ownership-scoped delete with one hard guard:
  **refuse to remove the last remaining credential.** This app has no password fallback and no
  recovery path; losing every authenticator loses the account, and the UI must not be the thing
  that causes it. If `credentialId` was added to `sessions`, delete those sessions in the same
  transaction.
- Optional: `signOutOtherSessions` (POST) — one click for "I left myself logged in on a shared
  machine".

`createSession` grows an options argument — `createSession(user, { userAgent, credentialId })` —
with the User-Agent read in the handler from the request (`@tanstack/react-start/server` already
provides the request access this needs; `webauthn.server.ts`'s `getRequestUrl()` is the in-repo
precedent, and `getWebRequest().headers.get("user-agent")` is the one that returns the headers).

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
  on mount and refetches after a revoke; loading and empty states.
- `describe-user-agent.ts` — hand-rolled UA → "Chrome on macOS" parsing with the raw string as
  fallback. No new dependency for this.
- Wire both into `settings.tsx` as "Sessions" and "Passkeys" sections between User and Profile. No
  new routes, so no `pnpm generate-routes`.

### Verification

`pnpm db:generate` produces one additive migration; `pnpm db:migrate` applies it; typecheck, unit
tests and `pnpm knip` stay green (every new export consumed). Manual pass: sign in on two browsers,
revoke the other one, and confirm its refresh fails — testable immediately by clearing that
browser's `access_token` cookie, or by waiting out the hour. Lefthook runs the rest on push.

---

## 3. One shared table list for the tombstone GC

- [ ] `src/modules/sync/synced-tables.ts` — import-free, exports both orders and both day counts
- [ ] `netlify/functions/tombstone-gc.ts` imports it; its local copies are gone
- [ ] `synced-tables.test.ts` locks the invariants the comments currently only claim
- [ ] `docs/architecture.md` updated where it says the list is "kept in step by hand"

### The constraint, stated precisely

`SYNCED_TABLES` lives in `src/modules/sync/sync-types.ts` (parents-first: profiles, accounts,
categories, transactions). `netlify/functions/tombstone-gc.ts` re-declares the same four names
children-first as `SWEPT_TABLES`, plus its own `RETENTION_DAYS = 90`. `STALE_CURSOR_AFTER_DAYS =
60` lives in sync-types and must stay well inside 90 — today that margin is enforced by comments
alone.

The function cannot simply import `sync-types.ts`: it is deliberately standalone — raw SQL over its
own postgres client, runnable by plain Node (`pnpm gc:tombstones`, Node's type stripping) and
bundleable by Netlify without dragging the app's server graph behind it. `sync-types.ts` imports
`~/database/tables` under the `~` alias, which resolves only through the app's bundler and tsconfig
paths — neither of which the standalone function shares.

So the shared module's defining property is: **zero imports of any kind.**

### Changes

1. New `src/modules/sync/synced-tables.ts`, import-free, exporting:
   - `SYNCED_TABLES` — parents-first, the pull/push order;
   - `SWEPT_TABLES` — children-first, the sweep order, with the cascade rationale comment carried
     over from the GC;
   - `STALE_CURSOR_AFTER_DAYS = 60` and `RETENTION_DAYS = 90`, co-located so the margin is one
     glance, with the "not measured by the same clock" rationale from both current homes.
2. `sync-types.ts` re-exports them — `export { SYNCED_TABLES, STALE_CURSOR_AFTER_DAYS } from
"./synced-tables"` — so the five existing import sites (`sync.functions.ts`, `idb.ts`,
   `integrity.ts`, `mutations.ts`, `integrity.test.ts`) stay untouched, and `SyncedTable` keeps
   deriving from `SYNCED_TABLES` as before.
3. `netlify/functions/tombstone-gc.ts` drops its local constants and imports instead:

   ```ts
   import { RETENTION_DAYS, SWEPT_TABLES } from "../../src/modules/sync/synced-tables.ts";
   ```

   The explicit `.ts` extension is what Node's type stripping needs to resolve the file, and
   `allowImportingTsExtensions: true` is already set in `tsconfig.json`, so `pnpm typecheck` stays
   clean. The path is relative (not `~/`) for the same reason as above.

4. New `src/modules/sync/synced-tables.test.ts`, same style as `integrity.test.ts`, turning the
   comments into red-or-green:
   - `SWEPT_TABLES` and `SYNCED_TABLES` contain exactly the same names — the "kept in step by
     hand" failure mode becomes a failing test the moment someone adds a synced table and forgets
     the sweep;
   - the sweep order is the reverse of the pull order (children before parents);
   - `RETENTION_DAYS - STALE_CURSOR_AFTER_DAYS >= 15` — the margin never silently converges
     (today it is 30; the floor is the author's call, but it must be positive and then some).

### Verification

`pnpm test:unit` (new test green), `pnpm typecheck`, and the one that actually proves the
constraint — `pnpm gc:tombstones` still runs standalone against the dev database
(`docker compose up -d db` first). Update `docs/architecture.md`'s "Deletes, tombstones and
retention" section and its constants table: the table list is no longer maintained by hand, and
`RETENTION_DAYS`'s "Where" column now points at the shared module.

---

## 4. A dark-mode theme file

- [ ] `src/styles/dark.css` holds the dark overrides; `styles.css` imports it
- [ ] Semantic tokens for necessity levels and warnings; `text-danger` for errors
- [ ] No `dark:` variant left in any component (`grep -r "dark:" src/` → only `src/styles/`)

### What exists today

The mechanism is already right: `src/styles.css` defines light tokens in `@theme`, then overrides
the same custom properties in a plain `@media (prefers-color-scheme: dark) { :root { … } }` block —
utilities resolve `var()` at use time, so that block _is_ the dark theme. What is missing is the
file the checklist asks for, and four components still carry raw palette classes with inline
`dark:` counterparts, against the repo's own rule ("semantic Tailwind tokens from `src/styles.css`,
not raw color classes"):

- `src/modules/transactions/necessity-level.tsx` — four levels × bg/text/border via raw
  `red/yellow/blue/violet` classes and `dark:` twins;
- `src/modules/transactions-import/ProcessingStep.tsx` — `text-amber-700 dark:text-amber-300`
  warnings, `text-red-600 dark:text-red-400` failures;
- `src/modules/transactions-import/UploadStep.tsx` — the same red error text;
- `src/modules/accounts/AccountCard.tsx` — gradient ends `dark:to-saving-muted-dark/50` and
  `dark:to-archived-muted/30`.

### Changes

1. **Move the dark block** into `src/styles/dark.css` (the `@media` `:root` overrides, plus the
   `color-scheme: light dark` declaration, which can move with it). Import it from `styles.css`:
   `@import "./styles/dark.css";` directly under `@import "tailwindcss";` — Tailwind v4's Vite
   plugin resolves and inlines `@import` at build time, so utility generation and override order
   are unchanged. This also tidies the doubled comment above today's `:root` block.
2. **Necessity tokens.** In `@theme`, light values; in `dark.css`, their dark counterparts:

   ```
   --color-necessity-low / -muted / -border      (red family)
   --color-necessity-medium / -muted / -border   (yellow)
   --color-necessity-high / -muted / -border     (blue)
   --color-necessity-essential / -muted / -border (violet)
   ```

   `necessity-level.tsx` then maps each level to `bg-necessity-low-muted text-necessity-low
border-necessity-low-border`-style classes — the raw palette and every `dark:` disappear from
   the markup.

3. **Warning tokens.** `--color-warning` and `--color-warning-muted` (amber family) in both themes;
   `ProcessingStep`'s warning panel uses them for its text, tinted background and border.
4. **Errors.** `text-danger` already exists and already flips dark — it replaces
   `text-red-600 dark:text-red-400` in both import files.
5. **AccountCard.** In the dark theme `--color-saving-muted` is already overridden to exactly
   `--color-saving-muted-dark`'s value, so `dark:to-saving-muted-dark/50` renders identically to
   plain `to-saving-muted` — drop the variant and delete the now-unused `-dark` token (AccountCard
   is its only consumer). For `dark:to-archived-muted/30`, an opacity-only difference (20% → 30%):
   either pick one opacity for both themes or, if the lift genuinely needs more contrast on dark
   paper, make it a token decision — the point is that the choice lands in the theme file, not in
   the component.

### Out of scope (deliberately)

A manual light/dark/system toggle. That needs `@custom-variant dark` keyed on a `data-theme`
attribute, a persisted choice (a cookie, so SSR paints the right theme first time), and a settings
control — real product work. This item delivers the theme file and de-inlines the variants;
`prefers-color-scheme` remains the only switch.

### Verification

`pnpm build` compiles, but note that Tailwind v4 silently skips a class with no matching token —
a missing token does not fail the build, it just does not style. So the real gate is a visual pass
in both schemes (DevTools emulation, or `colorScheme: "dark"` in a Playwright context — free once
item 1's fixtures exist), plus the grep above proving the markup is clean.

---

## Summary

Four items, no new dependencies, no changes to the offline-first flow:

- **Item 3** is the smallest and goes first: one import-free module, one invariant test, and the
  hand-maintained table list stops being a thing a new synced table can silently miss.
- **Item 1** turns an already-configured Playwright setup into three real specs, Chromium-only via
  the CDP virtual authenticator, isolated by unique-per-test users against the dev database. It
  also builds the `signedInPage` fixture every future spec inherits.
- **Item 2** is the only schema-touching item: three additive columns, five server functions
  following the existing middleware/validator conventions, two settings cards — and the honest
  UI copy about the hour a revocation takes to bite.
- **Item 4** finishes a token system that is already 90% there: one dark.css, tokens for the last
  raw-color holdouts, and zero `dark:` variants left in markup.

Deliberately not done anywhere in this plan: a password or recovery path (passkeys stay the only
way in), shortening the access-cookie TTL to make revocation snappier (it would re-add a query to
the hot auth path the design exists to avoid), a manual theme toggle, and cross-browser e2e — each
is noted where it belongs above, as a documented decision rather than an accident.

## Related Limitations

- **A device offline for more than 60 days pays for a full re-pull.** Tombstones are swept at 90
  days, so a local copy whose oldest cursor is past `STALE_CURSOR_AFTER_DAYS` is dropped rather
  than resumed from — otherwise it would keep deleted rows forever with nothing looking wrong. The
  60/90 margin now lives in one module and is enforced by a test (item 3).
- **Session revocation is up to an hour late.** The access cookie is stateless and verified without
  a query; deleting the session row takes effect when it next expires. Unchanged by item 2 — which
  surfaces the latency in the UI instead — and the accepted cost of a query-free auth path.
- **The tombstone GC's table list is shared, no longer hand-maintained.** The standalone function
  (raw SQL, no Drizzle) now imports one import-free module from `src/modules/sync/`, and a unit
  test fails if the sweep list and `SYNCED_TABLES` drift apart.
- **E2E covers three sync-critical paths, Chromium-only.** Playwright runs the boot gate, a
  two-tab sync, and an offline write end to end; Firefox/WebKit need the documented session-minting
  escape hatch if cross-browser coverage is ever wanted.
- **Passkeys only, single credential flow.** No password fallback and no recovery path — losing
  every registered authenticator means losing access. Item 2's `revokePasskey` refuses to remove
  the last credential, so the settings page cannot be the cause of it.
- **Currency rates are USD-quoted and refreshed once a UTC day**, cached client-side; an unknown
  currency falls back to 1:1 rather than dropping the amount. Unchanged.
