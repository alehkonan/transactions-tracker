# Local-first PWA startup release checklist

Status as of 2026-09-14: **local implementation complete; release blocked**. P01–P25 pass against a
fresh local production build/preview, including authenticated browser flows and deterministic fault
harnesses. Deploy Preview compatibility, the managed old-production cutover/rollback, and real iOS
installed-PWA lifecycle have not passed. No deployment was performed.

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

## Mandatory release and compatibility gates

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
- [ ] Run installed-PWA close/reopen, expiry, offline edit, storage eviction, and update checks on real
      iOS/Safari.
- [ ] After authorized deployment, repeat anonymous registration/cache and first/repeat navigation
      measurements; use an explicitly approved production test identity for any authenticated check.

Release remains blocked until every unchecked mandatory item is either passed or replaced by an
explicitly approved compatibility decision.
