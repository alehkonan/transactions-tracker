# First-Visit Performance Optimizations Plan

This plan turns the production audit of `https://crackertracker.netlify.app/` into a measured,
implementation-ready sequence. The audit covered the unauthenticated entry experience because `/`
currently returns a `307` to `/login`.

**No new dependency is needed.** The work must preserve the offline-first contract: login may render
without local data, authenticated reads still come from IndexedDB/Zustand, mutations remain
local-first, and the server remains a sync/auth backend rather than a client database.

## Baseline

Measured on 2026-08-23 with fresh browser contexts:

| Test                                            |        LCP |      CLS | Key detail                                     |
| ----------------------------------------------- | ---------: | -------: | ---------------------------------------------- |
| Desktop, unthrottled, `/` → `/login`            | **601 ms** | **0.00** | The root redirect took 227 ms; TTFB was 498 ms |
| Mobile 390×844, Slow 4G, 4× CPU, `/` → `/login` | **2.54 s** | **0.00** | The root redirect took 790 ms; TTFB was 1.04 s |
| Mobile, direct/cached `/login`                  | **1.24 s** | **0.00** | Useful comparison only; not a cold first visit |

The fresh mobile result is just beyond the 2.5 s “good” LCP threshold. The mobile trace broke the
2.54 s LCP down into 1.04 s TTFB and 1.50 s render delay. The final stylesheet was render-blocking
for approximately 1.09 s, despite being only about 8 KiB compressed.

The fresh login shell loaded approximately:

- 19 JavaScript requests, about 179 KiB transferred and 544 KiB decoded;
- 1 CSS request, about 8 KiB transferred and 41 KiB decoded;
- compressed HTML/CSS/JS over HTTP/2;
- a small post-load passkey-options request, which took about 1.7 s on the constrained mobile run
  but did not block LCP.

There is no CrUX field data for this URL yet, so these are lab results and should be repeated after
each production deploy.

## Goals and guardrails

- Bring a fresh constrained-mobile LCP below **2.5 s**, with an aspirational target below 2.0 s.
- Keep CLS at **0.00** and below the 0.1 Core Web Vitals limit.
- Make an unauthenticated visit to `/` render the login shell without an avoidable document redirect,
  while keeping authenticated root navigation and profile selection behavior intact.
- Avoid eagerly loading protected-route-only code on the login page where the bundle graph permits it.
- Cache only fingerprinted static assets for a long immutable lifetime; keep HTML and server-function
  responses uncached or revalidated as they are today.
- Preserve passkey autofill, the explicit sign-in/sign-up flows, the `resetLocalData()` ordering after
  sign-in, and the existing cancellation behavior between conditional and explicit WebAuthn
  ceremonies.
- Preserve the architecture guarantees in `docs/architecture.md`: route guards use cookie hints
  rather than RPCs, login does not wait for `SyncGate`, and protected pages hydrate from IndexedDB
  before background synchronization.

## Work summary

| #   | Item                                                        | Lands as                                                                            | Primary files                                                                                     | Risk                  |
| --- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------- |
| 1   | Immutable caching for hashed assets                         | Netlify cache headers for `/assets/*`                                               | `netlify.toml`                                                                                    | low                   |
| 2   | Remove the unauthenticated root redirect                    | Root entry renders the login shell directly when no live hint exists                | `src/routes/__root.tsx`, `src/routes/index.tsx`, shared login/shell code if needed                | medium                |
| 3   | Reduce the login critical module graph                      | Protected-only imports and post-sign-in cleanup move out of the initial login graph | `src/routes/__root.tsx`, `src/modules/auth/usePasskeyAuth.ts`, possibly a new app-shell component | medium                |
| 4   | Re-schedule conditional passkey setup, only if still useful | Idle/deferred background options request with cancellation                          | `src/modules/auth/usePasskeyAuth.ts`                                                              | medium (UX-sensitive) |
| 5   | Re-measure and regression-check                             | Production trace comparison and auth/offline verification                           | existing E2E suite and deployment checks                                                          | low                   |

Suggested order: **baseline → 1 → 2 → 3 → re-measure → 4 only if justified → final regression**.
The cache-header change is independent and low-risk. The root and bundle changes should be measured
separately so a regression can be attributed to one change.

---

## 1. Give fingerprinted assets an immutable cache lifetime

### Current state

`netlify.toml` defines the build and publish settings but no static asset headers. Production JS and
CSS files have content-hashed names such as `index-C7innIp-.js` and `styles-Cocbcbzn.css`, but the
observed response header is:

```http
Cache-Control: public,max-age=0,must-revalidate
```

Repeat visits therefore revalidate the assets and receive `304` responses. That still costs a
request round trip and contributed to the long CSS critical path under throttled conditions.

### Implementation

Add a scoped header rule to `netlify.toml`:

```toml
[[headers]]
  for = "/assets/*"
  [headers.values]
    Cache-Control = "public,max-age=31536000,immutable"
```

Keep the scope limited to fingerprinted build assets. Do not apply this policy to:

- HTML documents, which must continue to pick up new route manifests and asset names;
- `/_serverFn/*` responses, which are request-specific and must not be cached;
- authentication/session responses.

There is no existing `public/_headers` file. Prefer the `netlify.toml` rule; add a `_headers` file
only if a deploy-preview check proves the TOML rule is not applied by the Netlify TanStack Start
adapter. Do not maintain two competing rules without checking precedence.

### Verification

- Deploy a preview and inspect representative JS and CSS response headers.
- Confirm the first request is `200` and a second request is served from cache without a network
  revalidation.
- Confirm HTML remains `no-cache` and the auth server-function response remains uncached.
- Confirm a new build still works because changed content produces a new asset filename.

This item should require no application-code or database change and is independently reversible by
removing the header block.

---

## 2. Avoid the unauthenticated `/` → `/login` document redirect

### Current state

`src/routes/__root.tsx` runs a synchronous cookie-hint guard before every route:

- `/login` is allowed through;
- every other route without a live `session_hint` redirects to `/login`;
- a live session without a selected profile redirects to `/profile`.

`src/routes/index.tsx` then redirects `/` to `/transactions` for authenticated navigation. The
unauthenticated first visit therefore pays for a separate document navigation before the login shell
can be painted.

The hint is deliberately readable and forgeable. It is only a rendering/navigation hint; server
functions still prove the real session. Do not replace this with a database lookup or a session RPC,
because that would violate the offline-open behavior described in `docs/architecture.md`.

### Preferred design

Make `/` a valid entry route that chooses locally from the existing session hint:

- **No live session hint:** render the same login shell as `/login` directly at `/` with a `200`
  document response.
- **Live session hint:** retain the authenticated home behavior and navigate to `/transactions` (or
  to `/profile` when the existing profile guard requires it).
- **`/login`:** keep it as a direct, bookmarkable login URL and retain its signed-in-user protection.

The implementation should reuse the existing `LoginCard` rather than create a second copy of the
passkey form. If a shared wrapper is needed, keep it a single component in `src/components/` or the
auth module according to whether it is app-wide or auth-specific.

The root shell currently derives `isStandalone`/`isLogin` from the pathname and always imports the
protected shell dependencies. If `/` can render login for an unauthenticated visitor, update that
classification using the same isomorphic `hasLiveSessionHint()` predicate (or a route-level shell
value) so the unauthenticated root:

- is not wrapped in `SyncGate`;
- does not show the navbar or protected app chrome;
- produces identical SSR and client markup to avoid hydration mismatch;
- remains usable without IndexedDB or a network connection.

Keep the authenticated `/` behavior separate from the unauthenticated login shell. Do not make the
index route unconditionally render login, and do not remove the `/transactions` redirect for a live
session.

### Validation before considering this complete

- Fresh unauthenticated `GET /` returns the login document without a `307` to `/login`.
- Direct `/login` still renders the same form.
- A live session entering `/` still reaches the existing authenticated destination.
- A live session entering `/login` still leaves the login page and obeys the selected-profile guard.
- A stale/forgeable hint still follows the existing behavior: it may render the protected shell, but
  the first server rejection must still transition through the existing unauthorized path to `/login`.
- SSR and hydration produce the same standalone login shell at `/`.
- Existing passkey registration/sign-in and logout flows continue to work.

If serving the login shell at `/` introduces too much route/layout complexity, stop the experiment
rather than using a blind Netlify rewrite. A rewrite that changes the document but leaves the
TanStack Router location at `/` can create a route mismatch and must be proven safe with SSR and
client navigation tests.

---

## 3. Reduce the login page's eager JavaScript graph

### Current state

The server-rendered login document advertises many modulepreloads. The root shell statically imports
protected/app-wide concerns even when the current path is `/login`, including the navbar, toaster,
`SyncGate`, the sync store, and development tooling. In addition, `usePasskeyAuth.ts` statically
imports `resetLocalData()` from `sync-engine.ts`, even though that function is only needed after a
successful sign-in.

The login page currently fetched 19 JS files on a fresh mobile visit. The large `index` chunk was
about 86 KiB transferred, while the full initial JS graph was about 179 KiB transferred. The trace
shows CSS, rather than JavaScript execution, as the immediate LCP blocker, so this item should be
optimized for reduced contention and hydration work rather than promising a CSS-sized LCP saving.

### Implementation sequence

1. **Measure the production build graph first.** Record which root imports cause `sync-engine`,
   `useSyncStore`, navigation/date helpers, devtools, and other protected-route modules to appear in
   the login document's modulepreload list. Do not edit `src/routeTree.gen.ts`; it is generated.

2. **Move post-sign-in sync cleanup behind the success boundary.** In
   `src/modules/auth/usePasskeyAuth.ts`, replace the static `resetLocalData` import with a dynamic
   import inside `onSignedIn`, while preserving this exact order:

   1. complete the passkey server ceremony;
   2. load and run `resetLocalData()`;
   3. navigate to `/` with `replace: true`.

   The reset is security-sensitive on a shared device and must not be skipped or moved after
   navigation. The dynamic import is only intended to keep sync code out of the initial login graph;
   it must still execute before the authenticated app boots.

3. **Keep development tooling out of production.** Verify that the `TanStackDevtools` and router
   devtools imports/rendering in `src/routes/__root.tsx` are eliminated from the production client
   bundle. Gate them with the existing Vite environment rather than adding a dependency or a runtime
   network request. If a static import prevents tree-shaking, isolate the dev-only component behind a
   dev-only dynamic import.

4. **Isolate protected shell imports if the graph is still large.** If the first two changes leave
   `SyncGate`, the sync store, navbar, or toaster in the login-critical graph, extract the protected
   shell boundary from `src/routes/__root.tsx` into a route-aware component/layout. Keep the existing
   behavior that the navbar is hidden until `isHydrated` and that every protected route waits behind
   the boot gate. A new shared app-chrome component belongs in `src/components/` and must contain one
   React component per file.

   Prefer the smallest route/layout change that removes verified login-only dependencies. Do not
   restructure all routes solely to reduce a few KiB, and do not lazy-load the login form itself in a
   way that delays the SSR-painted form.

5. **Do not change router pending behavior as part of this item.** `defaultPreload: "intent"` and a
   positive `defaultPendingMs` in `src/router.tsx` are intentional. Lowering the pending threshold or
   disabling intent preloads globally can make normal navigation flash or feel slower, and it is not
   the cause of the first-document redirect.

### CSS handling

Keep the stylesheet render-blocking until there is evidence that CSS delivery remains the bottleneck
after the route and cache changes. It is only about 8 KiB compressed, and making it non-blocking by
using an unverified `media`/preload pattern could introduce a flash of unstyled login content and
hurt accessibility. Do not add a same-origin `preconnect`; the trace found no useful cross-origin
origin to preconnect.

### Verification

- Build and inspect the generated modulepreload list for `/login` and unauthenticated `/`.
- Confirm the initial login graph no longer includes clearly protected-only modules when they are not
  needed to render or interact with login.
- Confirm the authenticated first boot still loads sync code before protected content is exposed.
- Confirm `resetLocalData()` still clears local data before post-sign-in navigation.
- Confirm warm boot and offline behavior remain local-first: existing data appears from IndexedDB,
  background sync remains behind the UI, and the boot gate still handles an unauthorized pull.

Use the existing project path conventions for any new source file. If route files are added or
renamed while extracting a layout, run `pnpm generate-routes` and never hand-edit the generated route
tree.

---

## 4. Re-schedule the conditional passkey request only if needed

### Current state

`src/modules/auth/usePasskeyAuth.ts` starts conditional WebAuthn autofill in a mount effect. When
supported, it requests sign-in options immediately and then starts browser autofill. The request was
observed after initial rendering and did not directly affect LCP, so it is not a first-priority fix.
It is also a deliberate UX feature: a returning visitor can sign in without pressing a button.

### Conditional implementation

First re-test after items 1–3. Only defer this work if the background request still competes with
more important login resources or creates measurable battery/network cost.

If it is deferred:

- schedule the existing `startAutofill` work with `requestIdleCallback` and a bounded timeout
  fallback, so browsers without the API still work;
- keep the delay short enough that passkey autofill remains useful;
- cancel the scheduled work on unmount and when the user starts explicit sign-in or sign-up;
- continue using `WebAuthnAbortService.cancelCeremony()` so only one ceremony can be active;
- leave the `autocomplete="username webauthn"` field unchanged;
- keep explicit button flows independent of the idle callback and never make a button wait for the
  conditional request;
- preserve the current behavior where expected aborts are silent and real server/browser errors are
  shown.

Do not replace conditional autofill with a database/session request or make the login form depend on
server data. This item is optional and should be reverted if passkey discoverability or autofill
latency regresses.

### Verification

Use the existing Playwright virtual-authenticator coverage to prove both paths:

- a returning passkey can still sign in through conditional autofill;
- pressing **Sign in with a passkey** cancels any pending conditional ceremony and starts the explicit
  ceremony exactly once;
- **Create a passkey** still cancels conditional work before registration;
- unmounting the login route does not update state or start a ceremony afterward;
- browsers without WebAuthn autofill still show the normal login form and explicit button behavior.

---

## 5. Validation and release checklist

### Local checks

Run the focused checks required by the files changed:

- `pnpm build`
- `pnpm typecheck`
- `pnpm test:unit`
- `pnpm test:e2e` for root routing, passkey cancellation, auth round trips, boot-gate behavior, and
  offline-first flows
- `pnpm generate-routes` if route files were added or renamed

Run formatting/linting through the repository's normal Lefthook flow, or directly when diagnosing a
failure. Do not add a dependency for performance measurement.

### Production-like performance checks

For each deploy preview and the final production deploy:

1. Use a fresh browser context, not an already warmed cache.
2. Trace `/` on desktop without throttling.
3. Trace `/` at 390×844 with Slow 4G and 4× CPU.
4. Record LCP, CLS, TTFB, redirect time, stylesheet completion, number of initial JS requests,
   compressed transfer size, and decoded JS size.
5. Repeat the visit to validate immutable asset caching.
6. Inspect the final HTML and asset response headers.

Acceptance targets:

- unauthenticated `/` has no avoidable document redirect;
- fresh mobile LCP is below 2.5 s, with no CLS regression;
- hashed assets use `public,max-age=31536000,immutable`;
- HTML and `/_serverFn/*` responses are not cached as static assets;
- no console errors or duplicate passkey ceremonies;
- no regression in authenticated warm boot, offline reads, local-first writes, or unauthorized-session
  recovery.

### Rollback

- Item 1 rolls back by removing the scoped `[[headers]]` block from `netlify.toml`.
- Item 2 rolls back by restoring the root guard/index redirect pair; no data migration is involved.
- Item 3 rolls back by restoring static imports or the prior shell boundary; keep the generated route
  tree in sync if route files were moved.
- Item 4 should be independently revertible because it changes passkey timing and user experience.

No item in this plan should change the database schema, migrations, sync API, IndexedDB format, or
session-cookie authority.

## Out of scope

- Adding a service worker or changing cold-start offline support; that belongs in
  `docs/plans/offline-completeness.md`.
- Caching HTML, auth responses, or server functions.
- Replacing the offline-first boot sequence with server-side data loaders.
- Making CSS asynchronous without a measured FOUC-safe design.
- Adding preconnects for the same Netlify origin.
- Introducing a performance CI hard gate before the lab test is repeatable; the first phase should
  collect stable preview measurements, then add a budget if the environment supports it.
