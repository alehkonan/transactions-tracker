---
version: 1
slug: "src-modules-spheres-named-spheres-tsx"
primary_target: "src/modules/spheres/NamedSpheres.tsx"
related_targets: ["src/routes/_client.accounts.tsx"]
---

# Purpose balances

## Scope

Mode: Operate. The Purposes view within Accounts groups the same money by financial purpose across accounts. Preserve the application identity in DESIGN.md and the local-first data flow. This brief describes the implemented sphere surface, not a new global page template.

## Reading order and composition

- Lead with “What your money is for” and the existing explanation, with Create sphere as the section action.
- Keep one linear ledger, at most 56rem (896px) wide and aligned with the page's left content edge. Separate primary groups by 24px.
- Show Operating first, followed by the Funds and Capital groups when they contain active named spheres. Sort names within each group. Use the same row treatment for all spheres and single closing rules for groups.
- Summaries show only the sphere name, approximate combined USD balance, disclosure chevron, and any essential warning indicator. Keep totals right-aligned at every width; allow long names to wrap.
- Group archive, allocation history, and balance help beneath the active ledger with 4px gaps. Their muted, 44px-minimum summaries are secondary to the active balances.

## Expanded content

- Start every sphere closed. Expansion reveals exact balances by currency and the existing actions.
- Use a definition list up to 24rem (384px) wide, with currency codes left and monetary values right, separated vertically by 8px.
- On phones, Assign money and Move money share two equal columns when both are present; Manage occupies a separate line. From 640px, allocation actions sit together on the left and Manage aligns right.
- Keep empty-state copy in the space otherwise occupied by balances; do not retain an empty list that introduces an extra gap.
- Manage opens the existing dialog. Renaming, archiving, deletion safeguards, and allocation editing retain their current behavior.

## State and accessibility contract

- Use the USD rates already in the local store for approximate totals. Exact currency balances remain unchanged, and reconciliation stays exact within each currency.
- While history is incomplete, show “Loading…” for totals and loading copy for an empty balance list. Do not imply that no money has been assigned before loading completes.
- A negative currency balance remains visible as a warning icon and accessible explanation in the collapsed summary, even if conversion produces a positive combined total. Operating also indicates divergence from account totals.
- Keep native disclosure semantics and keyboard activation. Distinguish parent and child chevron state so expanding Archived does not rotate a closed child sphere's chevron.
- Preserve visible focus, 44px phone action targets, reduced-motion behavior, and semantic colors in both system themes. Set dialog field focus after mounting; return focus to the invoking control on close.

## Verification evidence

The implementation was visually checked in isolated Chromium previews with demonstration data in both system themes, with loading, empty, archived, negative-currency, and allocation-history states. Widths from 320px to 1280px, long names, large totals, keyboard disclosure, dialog focus, and focus restoration were inspected. These previews did not exercise persistence or financial mutations; repository checks remain delegated to Lefthook.
