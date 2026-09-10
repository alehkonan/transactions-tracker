---
target: /settings
total_score: 24
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 4
target_identity: "file:/Users/olegkonan/Projects/transactions-tracker/src/routes/settings.tsx"
target_fingerprint: "sha256:fb8bad034c261d40e48c1f057ad3f935109388c752b51ba98239287fb4c2ae81"
target_path: /Users/olegkonan/Projects/transactions-tracker/src/routes/settings.tsx
timestamp: 2026-09-10T13-23-54Z
slug: src-routes-settings-tsx
closed: true
---

# Critique: `/settings`

## Design Health Score

| #         | Heuristic                           |     Score | Key issue                                                                                     |
| --------- | ----------------------------------- | --------: | --------------------------------------------------------------------------------------------- |
| 1         | Visibility of system status         |       3/4 | Security and integrity states are strong; export and sign-out feedback is weaker.             |
| 2         | Match between system and real world |       3/4 | Storage persistence and server integrity are visually conflated.                              |
| 3         | User control and freedom            |       2/4 | Sign out immediately removes the local replica without warning.                               |
| 4         | Consistency and standards           |       2/4 | Export is a command styled as a link; identical Change labels produce different interactions. |
| 5         | Error prevention                    |       2/4 | Passkey removal is confirmed, but local-data clearing on sign-out is not.                     |
| 6         | Recognition rather than recall      |       3/4 | Most actions are visible, but the plus icon and abstract Change labels force guessing.        |
| 7         | Flexibility and efficiency          |       2/4 | Category management does not scale beyond a small list.                                       |
| 8         | Aesthetic and minimalist design     |       2/4 | Clean palette, but six equal fragments undermine hierarchy.                                   |
| 9         | Error recognition and recovery      |       3/4 | Security retry and integrity repair are strong; export and sign-out are weaker.               |
| 10        | Help and documentation              |       2/4 | Useful explanations exist, but the storage warning provides no next step.                     |
| **Total** |                                     | **24/40** | **Acceptable; significant structural improvement needed**                                     |

## Design Specificity Verdict

Visually product-aware, structurally generic. The warm paper/ink palette, restrained accent, and colored category tags support Cracker Tracker’s ledger-on-cracker-stock identity. The composition in `src/routes/settings.tsx:37-83` is nevertheless six generic fragments—User, Security, Profile, Categories, Import / Export, and Local data—stacked between identical rules. There is no Settings page title, stronger grouping, or product-specific operational model.

The deterministic detector returned zero findings for `src/routes/settings.tsx`. The live detector rendered six anti-pattern overlays, but DOM inspection tied them to TanStack Devtools under `#tanstack_devtools`, not the product page. The clipped-overflow, transition, gradient-text, and flat-hierarchy findings are false positives for this target. Browser overlay injection succeeded in a separate `[Human] Cracker Tracker — Settings` tab.

## Overall Impression

The page is functionally stronger than it looks. Offline, security, integrity, dialog, and accessibility states are solid, but the page lacks information architecture. At desktop, a roughly 1,248px content span separates labels from their actions. At mobile, the layout remains usable but becomes a long sequence of equal-weight settings dominated by ten category controls.

The largest opportunity is to replace the repeated heading/rule pattern with three named groups using consistent settings rows.

## Recommended Structure

### Account & access

- Username and account identity
- Passkeys with count/status and an `Add passkey` command button
- Password status and a `Change password` or `Add password` command button
- A separated danger row for sign-out, with copy explaining that local data is removed from this device
- `Refresh security details` as a scoped secondary command if manual refresh remains necessary

### Current profile

- Current profile name with a `Choose profile →` navigation link
- Categories summary such as `10 categories`
- `Manage categories →` as navigation and `Add category` as a command
- If categories remain inline, progressively disclose long lists instead of exposing every category at once

### Data & this device

- Transaction data: `Import transactions →` navigation plus an `Export CSV` command button
- Offline storage: persistent-storage status and, where supported, a `Protect local data` command
- Data integrity: match status plus a `Check this device` command; destructive recovery only after confirmed divergence

Use a constrained 720–880px single column, or a deliberate two-column group layout, rather than full-width rows inside `max-w-7xl`.

## What's Working

1. Security copy honestly explains that credential details come from the server and remain unavailable offline while the rest of settings stays usable.
2. Shared buttons and dialogs have semantic controls, visible focus, disabled states, mobile-friendly targets, and correct responsive behavior.
3. IntegrityCheck has strong progressive disclosure across checking, matched, unsettled, diverged, failed, and repairing states.

## Priority Issues

### [P1] No page-level hierarchy

The page starts with `User` as an h2 and has no Settings h1. Every section uses the same small title and identical rule. Add a Settings h1, introductory copy, and three semantic sections (`aria-labelledby`) for Account & access, Current profile, and Data & this device. Suggested command: `$impeccable layout`.

### [P1] No dependable grammar for commands versus navigation

Import is a link and looks like one; Export is a button styled as a link. Profile Change navigates while Password Change opens a dialog. Add category is icon-only. Use links with directional treatment for destinations (`Choose profile →`, `Import transactions →`, `Manage categories →`) and button surfaces for commands (`Export CSV`, `Add category`, `Refresh security details`, `Check this device`, `Sign out`). Replace abstract Change labels with object-specific labels. Suggested command: `$impeccable clarify`.

### [P1] The storage warning creates anxiety without agency

“This browser may clear local data…” sits next to Check this device, but integrity checking does not prevent browser eviction. Separate Offline storage from Data integrity, expose statuses for both, offer Protect local data where supported, and explain what remains durable on the server. Suggested command: `$impeccable harden`.

### [P1] Sign out conceals local-replica deletion

Sign out also calls `resetLocalData()` and clears IndexedDB without confirmation. Explain the consequence before the action, show synchronization state, confirm the operation, and use `Signing out…` while pending. Suggested command: `$impeccable harden`.

### [P2] Category management is a high-choice wall disguised as tags

Ten category edit buttons plus Add category are visible together. This does not scale and visually competes with higher-risk settings. Use a count, explicit Manage categories navigation, a labeled Add category button, and progressive disclosure if the list remains inline. Suggested command: `$impeccable distill`.

## Cognitive Load

Four of eight checks fail: chunking, grouping, visual hierarchy, and minimal choices. Single focus, one-thing-at-a-time behavior, working-memory support, and progressive disclosure otherwise pass. Categories is the only clear decision point above four options, exposing ten edit controls plus Add category simultaneously.

## Emotional Journey

The page opens without orientation because the first heading is User rather than Settings. Honest security copy builds trust. The profile/category middle flattens into repetitive maintenance. The storage warning creates the emotional valley because it raises a data-loss risk without a remedy. A successful integrity check can create a strong reassuring ending, but it is currently buried.

## Persona Red Flags

**Alex, power user:** must scan six equal headings; category editing does not scale; desktop actions are detached from labels by excessive width.

**Sam, accessibility-dependent user:** heading navigation starts at h2 without a page h1; DOM semantics are mostly strong, but sighted visual semantics contradict them when Export looks like a link.

**Casey, distracted mobile user:** must scroll through security copy and ten category targets before device safety; icon-only Add category is easy to miss; the storage warning lacks an immediate action.

## Minor Observations

- Rename User to Account and label the username explicitly.
- Label the selected value as Current profile.
- Rename Import / Export to Transaction data or Move your data.
- Rename Refresh to Refresh security details.
- Improve the Categories empty state with benefit-oriented copy and a text action.
- Verify contrast across every dynamic category color.
- TanStack Devtools overlap on mobile is a development artifact, not a product defect.

## Questions to Consider

- Are categories truly settings, or should they be a managed financial resource with their own screen?
- Should an offline-first product ever show browser-cleanup risk without a Protect local data action?
- If every command looked like a button and every destination looked like a navigable row, would any abstract Change labels remain necessary?
- Should sign-out be allowed while unsynchronized changes exist when it also removes the local replica?
