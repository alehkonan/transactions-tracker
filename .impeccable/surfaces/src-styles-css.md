---
version: 1
slug: "src-styles-css"
primary_target: "src/styles.css"
related_targets:
  [
    "src/routes",
    "src/screens/TransactionsScreen.tsx",
    "src/components",
    "src/modules",
    "public/manifest.webmanifest",
    "public/icon.svg",
  ]
---

# Cracker Tracker application shell

## Scope

Mode: Operate. Issue #34 implements the approved iOS-inspired visual language through the shared shell and transaction-list slice. Keep the existing local-first data flow, financial meanings, category identities, system-state visibility, and inbound links. Screen and workflow adaptation continues in #35–#42.

## Direction contract

THESIS: A clear grouped ledger with a flat pale-yellow page, white groups, black text, and familiar native controls.

OWN-WORLD: `#FFF3DD` light background, restrained 8px group corners, solid separators, aligned financial values, and a system-driven neutral dark theme with light text. No decorative gradients, page texture, or hover lift. The illustrated cracker stays in the application icon.

STORY: The user can scan transactions and retain search/filter context across the four destinations. Local availability, synchronization, expired sessions, conflicts, and recovery remain explicit.

FIRST VIEWPORT: A visible Transactions heading and count sit above search, filters, and Add transaction. The remaining-height white group contains virtualized transaction rows and pinned daily headers. Labeled Money, Transactions, Statistics, and Settings navigation stays at the bottom on phones and desktop.

FORM: The Grouped Ledger; code-led implementation of the direction explicitly approved in #34. The navigation footer occupies layout space, respects the safe area, and never covers the transaction list. Active state includes a top rule. Tab activation opens the destination root at the top while retaining filters/search; router and virtual-list restoration support Back.

FINISH: Verify phone and desktop layouts in both themes, explicit empty/error/loading states, retained state, and keyboard focus. Document actual shared tokens and components in DESIGN.md. Remaining detail pages, full Money composition, settings, statistics, auth-state styling, and import adaptation are tracked in #35–#42.
