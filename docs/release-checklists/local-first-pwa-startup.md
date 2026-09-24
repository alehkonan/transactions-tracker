# Local-first PWA startup release checklist

Status as of 2026-09-19: **complete for the owner-approved production scope**.
P01–P25 passed against a fresh local production build/preview, including authenticated browser flows
and deterministic fault harnesses. PR #9 merged into `main` on 2026-09-14. The owner confirmed that
the old client and Deploy Preview are no longer available and removed the real-iOS test from the
required scope. Historical pre-deployment gates below remain an audit record, not claims of a pass.

Statuses:

- **Passed** — the stated criterion was exercised in this environment;
- **Partial** — supporting automated coverage passed, but the complete scenario was not exercised;
- **Blocked** — attempted, but the environment prevented the scenario from reaching its assertions;
- **Not run** — requires a dedicated browser/deploy/manual run.

## Acceptance matrix

| ID  | Status | Evidence / remaining gate                                                                                                                             |
| --- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| P01 | Passed | Worker generation/classic execution tests and real Chromium registration/complete-cache activation passed on fresh builds.                            |
| P02 | Passed | A real proxy-held document request remained pending for 15s while the controlled cached navigation rendered locally in under 1.5s.                    |
| P03 | Passed | A real sync admission request remained pending for 15s while an account edit committed to IndexedDB/outbox.                                           |
| P04 | Passed | A previously unvisited statistics deep link, lazy chunk, URL, and filters opened after a cold offline reload.                                         |
| P05 | Passed | Missing auth cookies left the local transaction visible and preserved the exact durable replica/outbox through reload.                                |
| P06 | Passed | A post-boot `401` preserved rows/queue, exposed reauth, and produced no edit/online/visibility/one-minute retry storm.                                |
| P07 | Passed | Injected `503`, interruption, held request, and offline reload preserved rows/outbox and kept auth admission distinct.                                |
| P08 | Passed | Same-user password reauth and conditional passkey autofill preserved exact mutation IDs, seq, payloads, base timestamps, cursors, and selection.      |
| P09 | Passed | Failed password and cancelled passkey reauth preserved the exact queued replica and kept sync paused.                                                 |
| P10 | Passed | Reauth with B credentials returned owner mismatch without B cookies and preserved A’s exact pending obligations.                                      |
| P11 | Passed | An identity-only preflight rejects cookies B/replica A before cursors or outbox are read/transmitted; all automatic/manual triggers remain paused.    |
| P12 | Passed | A delayed A passkey callback could not cross an A→B→A replica replacement fence or mutate the replacement replica.                                    |
| P13 | Passed | Transition/replacement fenced stale account, transaction, and import actions; visibility resume invalidated stale tabs.                               |
| P14 | Passed | Six v2→v3 scenarios preserved rows, metadata, and exact outbox order; blocked upgrade remained an explicit retryable failure.                         |
| P15 | Passed | Empty/unique/mixed/outbox-only legacy classification and recovery export passed; ambiguous replicas neither synced nor wiped.                         |
| P16 | Passed | Profile create/select and dependent account creation worked offline and preserved profile-before-account outbox ordering.                             |
| P17 | Passed | A stale-cursor full pull failed through the public proxy while the prior replica remained byte-for-byte intact and visible.                           |
| P18 | Passed | A local edit during a held staged full pull advanced local revision; the stale replacement swap was fenced and the edit/outbox remained.              |
| P19 | Passed | Real A/B workers left two dirty A tabs untouched, retained A assets, and activated B only after all A clients closed.                                 |
| P20 | Passed | Missing, interrupted, and redirected B artifacts could not create completion metadata or displace working A.                                          |
| P21 | Passed | JS-disabled forged A/B cookie contexts received byte-identical anonymous HTML with no identity, financial, or redirect marker.                        |
| P22 | Passed | `/api/push`, unknown `/_serverFn/*`, and unknown `.js` retained real status/content-type/body and never became the successful SPA shell.              |
| P23 | Passed | Durable outbox warning, visible server sign-out failure with replica preservation, and successful financial rows/outbox/import-draft clearing passed. |
| P24 | Passed | IDB-unavailable retry and cache eviction showed distinct non-ready states; retry/repair preserved IndexedDB and never performed a silent reset.       |
| P25 | Passed | Empty and non-empty legacy HTTP envelopes failed closed; the same mutation ID was subsequently accepted as v2, proving no legacy row/receipt effect.  |

## Commands actually run

| Command / scope                                                        | Result                                                                                                   |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `pnpm exec vitest run vite-plugins/offline-service-worker.test.ts`     | Passed: 4/4 after strict no-redirect precache changes.                                                   |
| Focused T1–T8 Vitest set earlier in T9                                 | Passed: 14 files, 62 tests.                                                                              |
| `pnpm lint`                                                            | Passed earlier at the integration boundary: 0 warnings, 0 errors.                                        |
| `pnpm typecheck`                                                       | Passed earlier in T9.                                                                                    |
| Fresh `pnpm build && pnpm preview` through Playwright `webServer`      | Passed repeatedly for every targeted browser file.                                                       |
| `e2e/local-first/network-faults.spec.ts`                               | P02/P03/P06/P07 passed together; corrected P17/P18 full-pull matchers passed on focused retry.           |
| `e2e/local-first/local-first-startup.spec.ts`                          | Passed: 2/2 exact expiry/same-user password scenarios.                                                   |
| `e2e/auth/reauth-fencing.spec.ts` + `sign-out-obligations.spec.ts`     | Passed: P09/P12/P23; focused P08 conditional-autofill retry also passed.                                 |
| `e2e/auth/reauth-owner.spec.ts`                                        | Passed: 1/1 with exact pending A obligations.                                                            |
| `e2e/local-first/stale-tab-fencing.spec.ts`                            | P11 and P13 passed individually after identity-only admission was added.                                 |
| `e2e/local-first/offline-profile.spec.ts` + `storage-failure.spec.ts`  | Passed: P16 1/1 and P24 2/2.                                                                             |
| `e2e/pwa/anonymous-shell.spec.ts` + `worker-update.spec.ts`            | Passed: P21 1/1 and P19/P20 4/4.                                                                         |
| `e2e/pwa/offline-cold-start.spec.ts` + `recovery.spec.ts`              | Passed: 1/1 each; sample `local-ready` about 57ms first and 46ms repeat.                                 |
| `e2e/sync-protocol/push-route.spec.ts` + `push-receipt-replay.spec.ts` | Passed: 5/5 and 4/4.                                                                                     |
| Full E2E/unit/knip suites                                              | Not run; repository policy leaves broad validation to Lefthook and T9 intentionally used targeted files. |

## Deployed read-only smoke check — 2026-09-19

PR [#9](https://github.com/alehkonan/transactions-tracker/pull/9) merged on 2026-09-14. Its
[Deploy Preview](https://deploy-preview-9--crackertracker.netlify.app/) was reachable during this
historical smoke check, and [production](https://crackertracker.netlify.app/) served the same JavaScript and CSS
asset names in `offline-artifacts.json`. Their build IDs differ (`dacb3d006f0ba7197b9d` on the
preview, `ad7b6dd7d8a02caac0ad` on production), so this is evidence of the deployed asset set, not
proof that their complete server/backend configuration matches.

Unauthenticated GET requests on the preview returned HTTP 200 HTML for `/`, `/login`, and
`/statistics`, without document redirects. `POST /api/push` with an empty v2 envelope and no session
returned HTTP 401 `text/plain`; an unknown `/_serverFn/*` returned 403 `text/plain`; and a missing
JavaScript URL returned 404. The preview served `/sw.js` with `Cache-Control: no-cache`, a real
fingerprinted `/assets/*` JavaScript file and its versioned `/_shell/*` HTML with one-year immutable
caching, and the UI document with `max-age=0, must-revalidate`. These are live response checks only;
they do not exercise authenticated push, database connectivity, a controlled worker, an old client,
or the full P01–P25 browser matrix. The full-preview gate below remains unchecked.

## Production authenticated smoke check — 2026-09-19

Using the explicitly supplied test identity in the production browser, password sign-in succeeded.
The existing profile opened while its transaction pull was still progressing; the transaction,
statistics, account, and settings pages were usable before the pull finished. The sync indicator then
reported that everything on this device was on the server. Settings loaded security details from the
server, and its **Check this device** action reported that the local copy matched the server.

Reloading the protected settings route kept the session and local data available. Closing the browser
tab and reopening `/statistics` directly showed the stored statistics before the fresh server check
completed; sync returned to its completed state. The reopened tab had no captured console errors.
No financial rows, categories, accounts, or credentials were changed during this check.

On production, live unauthenticated HTTP responses also showed a 200 HTML document without redirect
for `/`, `no-cache` for `/sw.js`, one-year immutable caching for the versioned shell and a real hashed
JavaScript asset, 401 for an unauthenticated empty v2 `POST /api/push`, 403 for an unknown server
function, and 404 for a missing JavaScript file. This establishes route and cache precedence for those
requests, but does not validate authenticated push, failure recovery, old-client compatibility, exact
startup timings, or installed iOS PWA behavior.

## Production startup measurements — 2026-09-19

Two independent fresh Chromium 151 browser contexts loaded production `/` without an account. Each
context then repeated the navigation after `navigator.serviceWorker.ready`. Mobile used a 390×844
viewport, 150 ms network latency, 1.6 Mbps download, 750 Kbps upload, and 4× CPU throttling. These
are laboratory samples, not iOS results or population percentiles.

| Profile              | Visit                     |     TTFB |      LCP |    CLS | JS transfer | Worker controls page |
| -------------------- | ------------------------- | -------: | -------: | -----: | ----------: | -------------------- |
| Desktop, unthrottled | Fresh #1                  |   720 ms | 1,864 ms |      0 |      258 KB | No, installing       |
| Desktop, unthrottled | Fresh #2                  | 1,111 ms | 2,888 ms |      0 |      259 KB | No, installing       |
| Desktop, unthrottled | Repeat after worker ready |   263 ms |   324 ms |      0 |        0 KB | Yes                  |
| Mobile, constrained  | Fresh #1                  |   311 ms | 3,724 ms | 0.0267 |      258 KB | No, installing       |
| Mobile, constrained  | Fresh #2                  |   323 ms | 2,600 ms |      0 |      258 KB | No, installing       |
| Mobile, constrained  | Repeat after worker ready |   253 ms |   380 ms |      0 |        0 KB | Yes                  |

Every navigation returned HTTP 200 with zero document redirects. The anonymous shell installed one
complete `transactions-tracker-ad7b6dd7d8a02caac0ad` cache; after worker readiness, the repeated
page was controlled by the active worker and all 37 JavaScript requests had zero network transfer.
The two fresh constrained-mobile LCP samples exceed the 2.5-second goal in
[issue #17](https://github.com/alehkonan/transactions-tracker/issues/17); investigate the current
login-critical graph and loading trace before claiming that performance target is met.

In a separate fresh, unthrottled 390×844 Chromium context, the approved test account reached its
profile 9,872 ms after password submission, showed transactions at 9,940 ms, and finished the full
sync of 11,193 visible transactions at 33,987 ms. A warm reload showed locally stored transactions
at 128 ms and completed its server check at 3,960 ms. These are single wall-clock observations that
include profile selection and network conditions; they are not iOS PWA timings. No financial record
was changed, and credentials were not written to the repository or measurement artifact.

## Current production completion criteria

- [x] Record production anonymous registration, complete cache, and first/repeat navigation samples;
      perform an approved authenticated startup check.
- [x] Owner removed the real installed-iOS PWA check from the required scope on 2026-09-19. It was
      **not run** and is not represented as a passed test.

The owner-approved production checklist is **complete**. The fresh mobile LCP target from
[issue #17](https://github.com/alehkonan/transactions-tracker/issues/17) remains unmet in the two
laboratory samples above and stays a separate performance follow-up.

## Superseded pre-deployment gates — historical record

The owner confirmed on 2026-09-19 that the old client and Deploy Preview no longer exist. The
original release gates remain below to show which pre-deployment checks lacked evidence. Their
unchecked boxes are not current production completion criteria and must not be interpreted as passes.

- [ ] Run the full matrix against a disposable deploy preview with working test credentials and
      database connectivity. Verify static UI shell delivery, server functions, `/api/push`, and rewrite
      precedence together.
- [x] New server validation rejects unsupported protocol versions and owner mismatches in focused
      server tests.
- [ ] Run a real mixed-version A/B test with an old open IDB connection and old worker/client code.
- [ ] Execute the managed cutover from the currently released worker: preserve/export local-only
      obligations, verify B is installed with a complete cache, close every old tab/PWA window, reopen,
      and verify B controls the client and IDB v3 migration completed.
- [ ] Confirm whether a compatibility/bridge release is required for devices that cannot be forced to
      close all old clients. If required, stop before release and implement it separately.
- [ ] Verify return from offline with an outdated client and RPC identifier compatibility.
- [ ] Document and rehearse forward-fix rollback; do not deploy a client/backend that restores
      destructive pre-v3 reset or accepts legacy ownerless pushes.
