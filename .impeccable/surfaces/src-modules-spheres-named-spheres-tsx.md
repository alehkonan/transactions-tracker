---
version: 1
slug: "src-modules-spheres-named-spheres-tsx"
primary_target: "src/modules/spheres/NamedSpheres.tsx"
related_targets: ["src/routes/_client.accounts.tsx"]
---

# Purpose balances

## Scope

Mode: Operate. The Purposes view at `/accounts?view=purposes` under Money groups the same money by financial purpose across accounts and retains the Accounts total, including archived accounts. Preserve the application identity in DESIGN.md and the local-first data flow. This brief describes the implemented sphere surface, not a new global page template.

## Direction contract

THESIS: Browse purposes as destinations; inspect one sphere's exact balances, actions, and history on its page.

OWN-WORLD: Extend the approved pale-yellow page, white groups, semantic dark counterparts, straight separators, system type, and restrained corners.

STORY: See the same account money grouped by purpose, open a sphere, then assign or manage it through protected short sheets.

FIRST VIEWPORT: Parent-labeled Back and sphere name precede exact currency balances and an approximate total; relevant actions follow. The list keeps Operating first, with alphabetized Funds and Capital groups and separate archived navigation.

FORM: Issue #37 pins the grouped-list and detail-page structure; no concept seed applies to this specified extension.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Reading order and composition

- Lead with “What your money is for” and the existing explanation, with Create sphere as the section action.
- Keep one linear ledger, at most 56rem (896px) wide and aligned with the page's left content edge. Separate primary groups by 24px.
- Show Operating first, followed by the Funds and Capital groups when they contain active named spheres. Sort names within each group. Use the same row treatment for all spheres and single closing rules for groups.
- Rows link to `/accounts/purposes/$sphereId` and show the sphere name, approximate combined USD balance, forward chevron, and any essential warning indicator. Keep totals right-aligned at every width; allow long names to wrap.
- Place the separate `/accounts/purposes/archived` destination and balance-help disclosure beneath the active ledger with 4px gaps. Archived purposes use alphabetized Funds and Capital groups and link to the same stable detail pages. Allocation history belongs to the selected sphere's detail page.

## Detail content

- Lead each detail page with its sphere name and a parent-labeled Back control: Purposes for active spheres, Archived purposes for archived spheres. Keep the detail column at most 42rem (672px) wide.
- Show an approximate USD total and exact currency balances in a flat group. Use a definition list with currency codes left and monetary values right, separated vertically by 8px; Operating's list is at most 24rem (384px) wide.
- On phones, Assign money and Move money share two equal columns when both are present; Manage occupies a separate line. From 640px, allocation actions sit together on the left and Manage aligns right.
- Keep empty-state copy in the space otherwise occupied by balances; do not retain an empty list that introduces an extra gap.
- Create, assign, move, and manage reuse the existing short sheets and local-first mutations. Manage preserves fixed types, zero-balance archiving, history-based deletion safeguards, and restoration; allocation history preserves editing and deletion safeguards.
- Follow balances and actions with sphere-scoped account activity and allocation history. Account activity includes transactions and opening balances, shows 50 rows initially, and offers further batches of 50; transaction rows open their detail pages. Allocation history contains only reallocations involving the selected sphere and explains that account balances stay unchanged.

## State and accessibility contract

- Use the USD rates already in the local store for approximate totals. Exact currency balances remain unchanged, and reconciliation stays exact within each currency.
- While history is incomplete, show “Loading…” for totals and loading copy for an empty balance list. Do not imply that no money has been assigned before loading completes.
- A negative currency balance remains visible as a warning icon and accessible explanation in the destination row, even if conversion produces a positive combined total. Operating also shows exact account totals, purpose totals, and differences for divergent currencies.
- Use native links for sphere and archived navigation; reserve native disclosure semantics for balance help. Loading, missing or deleted purposes, other-profile access, incomplete history, and empty archived or activity lists have explicit states. Profile and replica changes reset the surface lifecycle.
- Preserve visible focus, 44px phone action targets, reduced-motion behavior, and semantic colors in both system themes. Set dialog field focus after mounting; return focus to the invoking control on close. Changed sheets require Discard changes or Keep editing on dismissal and browser Back; refresh uses the shared unsaved-change protection. Pending local saves prevent departure, successful persistence completes the task, and failures retain edits with an actionable error.

## Verification evidence

The implementation was checked in the running application with isolated, local-only synthetic IndexedDB data at 320px, 390px, and 1280px in both system themes. Browser checks exercised actual local mutations, failure handling and rollback, browser Back and dirty-sheet protection, exact per-currency reconciliation, and loading, missing, profile, archived, negative-currency, and history states. Independent review identified gaps in the UI-shell allowlist, activity performance, and navigation protection; all were corrected. The overall amount uses explicit primary text emphasis. The final archived-navigation recapture at 320 × 760px confirmed that Money, Transactions, Statistics, and Settings remain visible in the footer. No repository automated checks were run; formatting, linting, typechecking, unit tests, and knip remain delegated to Lefthook.
