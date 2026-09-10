---
target: transactions page
total_score: 21
max_score: 40
na_heuristics:
p0_count: 1
p1_count: 3
target_identity: "file:/Users/aleh/Projects/transactions-tracker/src/routes/transactions.tsx"
target_fingerprint: "sha256:f3102de29fb6584f34065101ec8bec035c60fd8a3b45ffe2b947fade666710df"
target_path: /Users/aleh/Projects/transactions-tracker/src/routes/transactions.tsx
timestamp: 2026-09-08T20-51-32Z
slug: src-routes-transactions-tsx
closed: true
---

Method: dual-agent (A: `55de900a-b084-4ecc-88b3-d96da220de59` · B: `72001cb3-521c-455c-9ee8-0f51aa6d7d32`)

## Design Health Score

| #         | Heuristic                           |     Score | Key issue                                                                                                              |
| --------- | ----------------------------------- | --------: | ---------------------------------------------------------------------------------------------------------------------- |
| 1         | Visibility of System Status         |   **2/4** | Sync/save are strong, but active filters, search debounce, and result count are not visible.                           |
| 2         | Match Between System and Real World |   **3/4** | Day grouping and money formatting are natural; necessity on income and USD normalization lack explanation.             |
| 3         | User Control and Freedom            |   **2/4** | Cancel/Escape and delete confirmation work, but there is no persistent Clear all or explicit mobile filter completion. |
| 4         | Consistency and Standards           |   **3/4** | Controls are cohesive; the mobile primary action changes both presentation and wording.                                |
| 5         | Error Prevention                    |   **2/4** | Validation exists, but with zero accounts the UI offers an impossible transaction flow.                                |
| 6         | Recognition Rather Than Recall      |   **2/4** | Main actions are visible, but applied filters must be remembered and row editability is implicit.                      |
| 7         | Flexibility and Efficiency of Use   |   **1/4** | No shortcuts, sorting, bulk actions, or desktop power-user presentation.                                               |
| 8         | Aesthetic and Minimalist Design     |   **3/4** | Strong visual system; desktop width is wasted and the empty state gives little guidance.                               |
| 9         | Error Recognition and Recovery      |   **2/4** | Errors are inline, but focus recovery and generic root errors provide insufficient direction.                          |
| 10        | Help and Documentation              |   **1/4** | Balance preview and sync help exist, but prerequisites, filters, and necessity are unexplained.                        |
| **Total** |                                     | **21/40** | **Acceptable — substantial trust and efficiency improvements are needed.**                                             |

## Design Specificity Verdict

**Visually authored, structurally generic CRUD.** The warm paper texture, cocoa borders, financial semantic colors, monospaced values, and explicit sync state clearly belong to Cracker Tracker. The composition itself—search, filters, Add, list, modal form—could belong to an unrelated inventory or task product. It does not surface profile/scope, record count, active period, multi-currency context, running impact, or connection to runway.

The deterministic detector returned `[]`: 0 findings. The major issues are behavioral and informational rather than banned markup/CSS patterns. Mutable browser injection succeeded, but `live-server.mjs --background` timed out, so no reliable overlay was produced. Fallback browser evidence included desktop/mobile snapshots, DOM geometry, browser issues, and Lighthouse accessibility (98), which found sync accessible-name mismatch and no main landmark.

## Overall Impression

The page looks calm, warm, and trustworthy while reading transactions. Its largest opportunity is to become a real financial ledger where state, filters, sums, and action consequences are always visible and truthful.

## What's Working

1. Offline-first state is product UX: local save visibly progresses from unsynced to Synced.
2. The visual system remains coherent in light and dark themes, with strong financial scanability.
3. Dialog mechanics are thoughtful: Escape, focus return, inline validation, mobile sheets, and safe delete-confirmation focus work predictably.

## Priority Issues

### [P0] Mobile creation CTA is covered by bottom navigation

In a populated list at the observed 500×725 viewport, the Add card occupied roughly y=652–712 and the fixed bottom nav intercepted its click. This blocks the primary mobile task. Keep Add in the mobile toolbar or fix it above navigation/safe-area; if the card remains, reserve full nav height in the virtualized layout and add a populated-mobile e2e test.

Suggested command: `$impeccable adapt`

### [P1] Financial feedback appears precise but is false

Editing an unchanged $12.34 expense previewed $987.66 → $975.32, applying the existing transaction again. A visibly unselected necessity silently persisted as Medium. Calculate edit previews from a baseline with the original record removed; explicitly represent a Medium default or require selection; decide whether necessity applies to income; cover amount/account/type cases with regression tests.

Suggested command: `$impeccable harden`

### [P1] The true empty state leads to an impossible flow

With zero accounts, the empty state says to add a transaction, but Account is required and the selector has no usable option. Separate no-accounts, no-transactions, search miss, and filtered miss states. For no accounts, show Create an account first with an Add account CTA and replace or disable transaction triggers with a reason.

Suggested command: `$impeccable onboard`

### [P1] Applied filters are hidden and costly on mobile/screen readers

After closing the dialog there is no active count, chips, or summary; mobile has no visible Done/Close. Reset controls share the name Reset selection. The date picker exposes 12 months, 101 years, and the current days. Add `Filters · 2`, removable chips, Clear all, explicit Done/Close, contextual reset names, bounded years, and useful date presets.

Suggested command: `$impeccable clarify`

### [P2] Desktop is a stretched mobile list rather than a ledger

At 1440px, a row spans about 1280px without stable columns, headings, count, or sorting. Preserve compact mobile rows and introduce a desktop grid for Date/time, Type, Category, Account, Note, Necessity, Amount, and Approx USD, with right-aligned tabular money and visible scope/range/count.

Suggested command: `$impeccable layout`

## Cognitive Load

Four of eight checklist items fail: visual hierarchy, minimal choices, working memory, and progressive disclosure. The main overload points are seven simultaneously visible transaction/necessity modes and the calendar, especially its accessibility tree. Single focus, day chunking, grouping, and dialog isolation pass.

## Emotional Journey

Arrival feels calm and reliable; the no-account state becomes a dead end. Populated mobile rows are receipt-like and clear, while desktop loses ledger rigor. Balance preview plus unsynced → Synced should be the trust peak, but double-counted edit preview and invisible necessity defaults reverse that trust. Filtering ends weakly because visible context disappears when the dialog closes.

## Persona Red Flags

**Alex — power user:** no shortcuts, sorting, bulk actions, density controls, or desktop-grade ledger scanning.

**Sam — accessibility-dependent:** no main landmark/page h1, 101 year options in the calendar, duplicate reset names, sync name/content mismatch, and search input without id/name.

**Casey — distracted mobile user:** Add is intercepted by bottom navigation, active filters disappear, no explicit filter Done/Close exists, empty copy conflates causes, and edit balance preview is misleading.

## Minor Observations

- `No transactions in this range` is wrong for search miss or no range.
- `Clear the filters` has no inline action.
- Income-only days still show `Spent: $0.00`.
- Approximate USD lacks an explicit `≈`/approx marker and conversion basis.
- Clickable rows lack a visible edit affordance.
- Result count is absent.
- Mobile sync strip is about 25px high, below the recommended 44px target.
- TanStack Devtools low-resolution image warning is not a product issue.

## Questions to Consider

- If history is evidence for balances and runway, why is it less rigorous than a real ledger?
- If Medium necessity is stored automatically, why is it not shown as selected, and should necessity exist for income?
- Why do lightweight persistent filters disappear inside a modal after application?
- Should balance preview remain available until edit/account/type/currency cases are covered by tests?
