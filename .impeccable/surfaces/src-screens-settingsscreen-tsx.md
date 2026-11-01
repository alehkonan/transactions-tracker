---
version: 1
slug: "src-screens-settingsscreen-tsx"
primary_target: "src/screens/SettingsScreen.tsx"
related_targets:
  [
    "src/screens/ProfilesScreen.tsx",
    "src/screens/CategoriesScreen.tsx",
    "src/screens/SecurityScreen.tsx",
    "src/routes/_client.settings.tsx",
    "src/routes/_client.profile.tsx",
  ]
---

# Settings and profiles

Mode: Operate. Scope: issue #40, settings, category and credential pages, and profile selection. Keep all existing local-first mutations, credential safeguards, and protected short-task sheets.

## Direction contract

THESIS: Settings groups personal access, the current financial profile, and device data into clear rows; longer management tasks have their own pages.

OWN-WORLD: Inherit the approved flat grouped-list system, semantic theme tokens, straight separators, system typography, and restrained corners.

STORY: Identify the current user and profile, open management pages, and return through labeled Back links. Short edits retain explicit saves and protected dismissal.

FIRST VIEWPORT: A Settings title followed by three stacked groups. Credentials and categories open dedicated pages. Import, export, local storage, integrity, and explicit sign-out remain discoverable.

FORM: The issue-specified grouped list, code-led; no concept seed because the structure and visual direction are approved in #40. Profile rows expose selection, current state, editing, deletion, and financial summaries.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Implementation

Issue #40 implements centered content up to 768px wide, three flat Settings groups, dedicated category and sign-in-method pages with Settings Back links, and grouped profile selection. Profiles expose current state, financial summaries, and Open/Edit/Delete actions. Existing selections return to Settings; onboarding enters the ledger. Category management uses full-width native rows. Thin native wrappers reuse semantic tokens and existing corners; protected sheets and local-first mutations remain in place. No new design tokens or raster assets ship.

## Validation and finish

Browser validation used synthetic local data and 15 screenshots across 390px mobile and 1440px desktop layouts, both themes, long names, empty states, offline state, and error feedback. Live credential mutation was not exercised. New routes were generated. The design detector returned no findings; standards review cleared after UI_PATHS registration was fixed, and spec review cleared. The fresh finish review verdict was **Ship**, with no material UI defects. DESIGN.md records the implemented pattern within the approved visual system.
