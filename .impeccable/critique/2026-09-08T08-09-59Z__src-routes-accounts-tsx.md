---
target: /accounts
total_score: 25
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 3
target_identity: "file:/Users/aleh/Projects/transactions-tracker/src/routes/accounts.tsx"
target_fingerprint: "sha256:77e8326025b80323d3bf921a1ffb454c92a4a8ade20b39a24a1b37c5e7984c85"
target_path: /Users/aleh/Projects/transactions-tracker/src/routes/accounts.tsx
timestamp: 2026-09-08T08-09-59Z
slug: src-routes-accounts-tsx
---

# Critique: `/accounts`

## Design Health Score

| #         | Heuristic                               |     Score | Key issue                                                                                                         |
| --------- | --------------------------------------- | --------: | ----------------------------------------------------------------------------------------------------------------- |
| 1         | Visibility of system status             |       3/4 | Mobile explicitly says “Synced”; desktop reduces it to an unclear cloud icon.                                     |
| 2         | Match between system and the real world |       3/4 | Current/Savings and currencies are understandable, but the USD total above a EUR account is unexplained.          |
| 3         | User control and freedom                |       2/4 | Groups collapse, but cards do not clearly indicate editing, and undo is not visible.                              |
| 4         | Consistency and standards               |       3/4 | The card system is coherent, but the desktop CTA is disproportionately wide.                                      |
| 5         | Error prevention                        |       3/4 | Offline-first protects data, but unclear conversion can lead users to misinterpret amounts.                       |
| 6         | Recognition rather than recall          |       2/4 | Data is visible, but mobile navigation lacks labels, desktop sync lacks text, and editing affordances are hidden. |
| 7         | Flexibility and efficiency              |       2/4 | The page is easy to scan, but lacks a clear power-user path or quick account actions.                             |
| 8         | Aesthetic and minimalist design         |       3/4 | Quiet, focused and distinctive, but desktop space is empty and the CTA dominates.                                 |
| 9         | Error recognition and recovery          |       3/4 | Sync errors use plain language; the form's error state was not triggered.                                         |
| 10        | Help and documentation                  |       1/4 | Neither the USD equivalent nor the fact that tapping a card opens editing is explained.                           |
| **Total** |                                         | **25/40** | **A good foundation, but trust in the figures and the hierarchy need work.**                                      |

## Design Specificity Verdict

The visual world is recognizable: warm “paper,” brown ink, subtle grain, cracker-like shapes and monospace financial values belong to Cracker Tracker. Light mode is particularly convincing.

The composition is less specific. Two groups of cards and a large CTA could fit any account manager. The page distinguishes current funds from savings but does not deliver the main product promise: understanding overall financial capacity and runway.

The deterministic scan of `src/routes/accounts.tsx` returned 0 findings. It found no mechanical anti-patterns in the route file, but this does not rule out semantic and compositional issues in child components and the live interface. The live overlay was unavailable: mutation preflight passed, but `live-server.mjs --background` timed out, so a user-visible overlay cannot be claimed.

## Overall Impression

The first impression is a calm, tidy and unusually human financial interface. Its weakness is product hierarchy rather than styling: the screen ends with account administration instead of answering “what is my financial position?” The most urgent issue is the unexplained relationship between `$14,412.50` in the Savings heading and `€12,400.00` on its only card.

## What Works

1. **A distinctive visual voice.** Warm stock, the ink palette, texture and shapes give the product character without decorative noise.
2. **Current and Savings are easy to distinguish.** Group headings, separate totals and distinct surfaces support the core financial model.
3. **Strong financial typography.** Monospace stabilizes figures and makes them easy to scan, especially on mobile.

## Cognitive Load

Moderate load: 2 of 8 criteria failed.

- Passed: single focus, chunking, grouping, one thing at a time, minimal choices and progressive disclosure.
- Failed visual hierarchy: the main financial fact lacks emphasis, while the desktop CTA becomes the largest element.
- Failed working memory: users must work out why a EUR account produces a USD total and reconstruct the exchange-rate context themselves.
- No decision point has more than 4 simultaneous options; the four primary navigation items are at the acceptable limit.

## Emotional Journey

1. Entering the page feels warm, calm and personal.
2. Current versus Savings is immediately legible; large monospace balances convey control.
3. The unexplained pair `$14,412.50 / €12,400.00` creates doubt precisely where trust in the figures matters.
4. Mobile “Synced” reassures users that their data is safe; the desktop cloud-only state weakens this effect.
5. The closing emphasis is “Create a new account,” so the peak-end impression remains administrative rather than clarifying the financial position.

## Priority Issues

### P1 — Converted totals look like unexplained balances

**Why it matters:** Savings shows `$14,412.50`, while its only account shows `€12,400.00`. Users cannot tell whether this is a USD equivalent, an approximate amount, a stale rate or an error.

**Fix:** Label the total `Savings · ≈ $14,412.50 USD` or `USD equivalent`; disclose the rate date on demand; explicitly show the estimate's freshness when offline or using a stale rate.

**Command:** `$impeccable clarify`

### P1 — Sync status inspires trust on mobile but is cryptic on desktop

**Why it matters:** Explicit synchronization state is a product principle. Desktop reduces it to a small cloud icon whose meaning depends on hover or prior knowledge.

**Fix:** Keep a short label such as `Synced`, `Offline` or `3 unsynced` at every width; after a manual check, show `Checked just now` if useful.

**Command:** `$impeccable clarify`

### P1 — The collapsible account structure is semantically incomplete

**Why it matters:** There is no `<main>` or page-level `<h1>`. Current/Savings buttons do not expose `aria-expanded` or `aria-controls`, so a screen reader cannot explain that they control groups.

**Fix:** Add a main landmark and a restrained `<h1>Accounts</h1>`; connect group buttons and panels through stable IDs, `aria-expanded` and `aria-controls`; preserve section headings.

**Command:** `$impeccable audit`

### P2 — The desktop composition wastes space and overemphasizes account creation

**Why it matters:** Narrow cards sit against the left edge, most of the 1440px viewport is empty, and a dashed CTA spans almost the entire width with more visual weight than the balances.

**Fix:** Use a bounded two-column ledger for Current/Savings or a primary balance column with a compact summary; size the creation action to match a card; use space for Available now, Reserve and a runway link.

**Command:** `$impeccable layout`

### P2 — The page remains an account inventory instead of explaining financial capacity

**Why it matters:** Users see two amounts without a synthesis; the screen ends with account creation rather than an understanding of their position.

**Fix:** Add a restrained summary above the groups: Available now, Reserve, Estimated runway or an explicit Statistics link; keep current funds and savings distinguishable rather than merging them into an unclear total.

**Command:** `$impeccable shape`

## Persona Red Flags

**Sam — screen reader/keyboard user:** The main landmark and page heading are missing; group controls do not announce expanded state; cards do not announce that they open Edit account. Mobile navigation has accessible names but no visible labels.

**Jordan — personal finance newcomer:** May interpret `$14,412.50` as a separate savings balance; cannot discover that tapping a card edits it; must guess the desktop sync icon's meaning; lacks contextual conversion help.

**Casey — distracted mobile user:** Large targets and bottom navigation are convenient, but four unlabeled icons require recognition; a meaningful cross-account summary is missing; the explicit mobile sync label unexpectedly disappears on desktop.

## Minor Observations

- In dark mode, Current and Savings converge on similar brown/amber surfaces and are less distinct than in light mode.
- `Active` is redundant within already-active groups; currency, institution or recent activity would use that space better.
- The chevron shows collapse state visually but remains a subtle interaction cue.
- TanStack Devtools overlaps mobile Settings only in development; this is not a production defect.
- The browser console showed no warnings/errors in the inspected mobile dark state.

## Questions to Consider

- Should the accounts page end by suggesting another account, or by answering “how much can I safely spend, and what is my runway?”
- Without the USD total, would Savings be understandable, or does the interface currently depend on unexplained arithmetic?
- Is `Active` on every card more useful than currency context and freshness?
- What would desktop look like if designed as a financial ledger rather than a stretched mobile card stack?
