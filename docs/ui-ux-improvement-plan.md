# UI/UX improvement plan

A review of the running app (dev server on `:5454`) at desktop and phone sizes, and what to do about
what it turned up. Companion to `architecture.md`, which covers how the app works rather than how it
reads.

## How this was reviewed

Chromium via Playwright, signed in with a virtual WebAuthn authenticator, against a seeded profile:
3 accounts, 13 categories, 241 transactions spanning 200 days (imported through the app's own CSV
flow, so the data is shaped the way a real import shapes it).

- **Desktop** 1440×900, **phone** 390×844, both at 2× and `en-US` / `Europe/Warsaw`.
- Every route: `/`, `/accounts`, `/transactions`, `/statistics`, `/settings`, `/profile`,
  `/transactions-import`, plus the add/edit transaction dialog, the date filter, row selection, and
  the signed-out and empty states.
- Console was clean on every route at both sizes — **no hydration mismatches, no runtime errors**.

## What already works

Worth saying plainly, because the rest of this document is a list of problems:

- The sync status indicator, the day-grouped table with its per-day totals, the balance preview in
  the transaction form, and the `Money runway` figure are all genuinely good ideas that most
  budgeting apps don't have.
- Settings is the best-composed screen in the app: clear sections, plain-language copy
  ("Compares this device against the server without downloading anything"), sensible order.
- Row selection, bulk delete, virtualised scrolling over 241 rows, and the import stepper all work
  correctly.
- The empty states on `/profile` are written like someone thought about them.

---

## P0 — defects that block a normal task

**All four are fixed.** What each one turned out to be, and what it took, is kept below rather than
deleted — the diagnosis is the part worth having later.

### 1. Select triggers render empty, so you can't see what's chosen — _fixed_

In the add-transaction dialog, **Category** and **Account** render as a bare 46px chevron with no
placeholder and no value. The DOM shows `<span data-placeholder="" class="truncate"></span>` — empty.
Once a value is picked the trigger jumps to 229px ("Millennium current (USD)"), so the control also
changes width under the user.

Root cause is one expression: `src/components/Select.tsx:68`

```ts
const withPlaceholder = (v: string | undefined) =>
  v ?? (placeholder ? PLACEHOLDER_VALUE : undefined);
```

`SelectControl` passes react-hook-form's value, which is `""` for an unset field
(`transaction-form-values.ts:27`), and `"" ?? x` is `""` — not nullish, so the placeholder sentinel is
never substituted and Base UI matches no item.

**Fixed:** empty string is treated as absent (`v || …`), and the trigger carries a `min-w-32` so it
no longer resizes under the pointer. Both selects now read "None" and "Select account".

### 2. A transaction has no date field — _fixed_

`TransactionFormValues` (`src/modules/transaction-form/transaction-form-values.ts:7-16`) has no
`createdAt`. You cannot set the date when adding, or correct it when editing — every manual entry is
stamped "now". For an expense tracker, entering yesterday's coffee is the common case, and today it is
impossible without a CSV round-trip.

**Fixed:** a `Date` field sits under the type toggle, backed by a new `DatePickerControl`
(`src/components/DatePickerControl.tsx`) that wires `DatePicker` to react-hook-form. It defaults to
now, refuses future days, and carries the time of day across a selection — the calendar picks a day,
and time is what orders two entries made on the same one. `TransactionInput` already accepted a
`createdAt`, so nothing below the form had to change.

### 3. There is no dark mode — _fixed_

`src/styles.css:3` defines one palette under `@theme` and there are no dark overrides anywhere. The
`dark:` utilities scattered through the markup (`ProcessingStep.tsx:24`, `--color-saving-muted-dark`)
can only tint a few details on a page that stays white. Rendering with
`prefers-color-scheme: dark` produced a pixel-identical light page.

**Fixed:** `styles.css` now overrides the tokens under `@media (prefers-color-scheme: dark)`, and
declares `color-scheme: light dark` so the browser paints its own furniture to match.

Fixing it exposed a second defect that had been invisible: **nothing set a base text colour**. `body`
carried `bg-background` but no `text-*`, so every element that didn't name a colour inherited the
browser's default black — which looks deliberate only while the page behind it is white. Measured
after the token change, table dates and amounts computed to `rgb(0, 0, 0)` on a near-black surface.
`body` now carries `text-text`. No manual toggle yet: the app follows the system.

### 4. Import silently rewrites unsupported currencies to USD — _fixed_

`currencyCodeEnum` is `USD, GEL, BYN, KZT, RUB, TRY, EUR, UZS`. A CSV with `PLN` doesn't fail — it
falls through `?? "USD"` at `build-import-plan.ts:159` and the account is created in dollars. The
import report said "Created 241, Failed 0". Every balance on every screen was then wrong, and nothing
said so.

**Fixed:** `buildImportPlan` now returns `warnings` alongside `failures` — one per unrecognised
currency, naming the accounts it touched and the currency each ended up with — and the report renders
them above the failure list. The rows still import, since the money moved either way; the import
just stops pretending it understood the file. A blank currency column claims nothing and stays
silent. Covered by two cases in `build-import-plan.test.ts`.

Still open: whether the enum should become a validated text column, so PLN and friends simply work.

---

## P1 — mobile

The phone experience is materially worse than the desktop one, and it's the size where a
transactions tracker actually gets used — at the till, not at a desk.

### 5. The amount column is off-screen on a phone

`transactions-table-columns.tsx` declares fixed widths totalling ~875px, and `DataTable` virtualises
columns horizontally. At 390px you see **Datetime and Category only**. Amount, account and type
require a sideways scroll, and the day-summary rows ("Spent: $131.81") sit in that off-screen region
too — at rest they're blank grey strips. Date and amount, the two things anyone scans for, can never
be on screen together.

**Fix:** below `sm`, stop rendering a table. Render a list row instead:

```
┌──────────────────────────────────────────┐
│ Groceries · Revolut EUR          −€7.35  │
│ 11 Aug · Medium                  ≈−$8.48 │
└──────────────────────────────────────────┘
   ── Tue 11 Aug ·············· −$8.48 ──     ← day header, not a trailing summary
```

Keep `DataTable` for `sm` and up. The row data already exists in `TransactionRow`; this is a
presentation swap, not a data change.

### 6. Day totals come after their day

`renderGroupSummary` emits the summary _below_ the group it summarises, so you read the total before
you know which day ended. Making it a sticky day **header** (date + net for the day) reads forwards
and removes 100+ half-height rows from the scroll.

### 7. Primary actions on mobile have no accessible name

`Add` on `/transactions` (`src/routes/transactions.tsx:73-76`) and `New profile`
(`CreateProfileButton.tsx:51-53`) hide their label with `hidden sm:block` and add no `aria-label`, so
below `sm` they are unnamed buttons — Playwright can't find them by name and neither can a screen
reader. `CreateAccountButton` does it correctly, which is the inconsistency to resolve.

**Fix:** `aria-label` on every icon-only button; audit for `hidden sm:block` inside a `Button`.

### 8. Touch targets are 26–36px

Measured on a phone: every button is `h-9` (36px), the necessity toggles and category chips are
26–28px. WCAG 2.5.8 asks for 24px minimum, Apple and Material both ask for 44px. The category chips
in Settings are edit buttons at 28px.

**Fix:** a `size="touch"` variant, or bump to `h-11` below `sm`.

### 9. Statistics is three screens of chrome before a chart

At 390px the three stat cards occupy ~1000px stacked, so the spending chart starts below the fold on
a screen that exists to show you the chart. Each card is ~330px tall to display one number.

**Fix:** on mobile, collapse the three stats into a single three-up strip, chart first.

### 10. Account cards are mostly empty

An account card is ~230px tall on desktop and ~450px on a phone, carrying a name, a type, a status
chip and a balance. Three accounts fill a 900px desktop viewport and overflow a phone. The gradient
is doing all the work and none of the communicating.

**Fix:** halve the height and spend the recovered space on something real — last activity, this
month's delta, a 30-day sparkline.

---

## P2 — information design

### 11. The dashboard is the emptiest screen in the app

`/` is the landing route and renders one card listing account balances, inside a `md:grid-cols-2`
whose second column is empty. Roughly 85% of a 1440×900 viewport is blank. It is also the only screen
a user sees before deciding whether the app is worth opening again.

The app already computes the most interesting number it owns — **Money runway**, "3 months 11 days" —
and buries it third on a secondary page. See the visual direction below for what to do with it.

### 12. Every row shows the same two chips

`Necessity: Medium` and `Type: Expense` render on every row. Two full columns and a lot of colour
carry almost no information, while `Account` truncates to "Millennium cu…" next to 500px of unused
table width.

**Fix:** drop the Type column (the sign and colour of the amount already say it; keep the icon only
for transfers), show necessity only when it isn't the default, and give the reclaimed width to
Account and Amount. Consider a running-balance column, which is what people actually reconcile
against.

### 13. No search, no category filter

241 rows, and the only filters are date range and account. There's no text search over comments and
no filter by category — even though category is the field the app tints, tags and charts by.

### 14. The spending trend flatlines into the future

`SpendingTrendCard` plots cumulative spend across _every_ day of the month, so on 13 Aug the line
runs flat to the 31st and reads as "spending stopped". Cut the series at today, or render the
remainder as a dashed projection to the month's expected total.

Also: the axis ticks are rendered as bordered pills (`AxisChipTick`), which gives chart furniture the
same visual weight as the data. Plain muted labels, abbreviated (`$2.5k`), would let the line lead.

### 15. Missing the chart the app is for

There is no category breakdown anywhere. "Where did the money go" is the first question a
transactions tracker exists to answer, and the app can answer it entirely from data already in the
store. A ranked bar list (not a pie) for the selected month is the highest-value addition to
`/statistics`.

### 16. Copy that leaks the implementation

| Now                                               | Better                                                         |
| ------------------------------------------------- | -------------------------------------------------------------- |
| `Datetime` (column header)                        | `Date`                                                         |
| `Delete rows (2)`                                 | `Delete 2 transactions`                                        |
| `No data` (empty table)                           | `No transactions in this range. Clear the filters or add one.` |
| `Current` / `Saving` (account type on every card) | show only when it disambiguates                                |
| `Check this device`                               | fine — this one is good                                        |

Empty states are an invitation to act; `No data` is a database talking.

---

## P3 — polish

- **Minus signs are inconsistent.** The table uses hyphen-minus (`-$131.81`), account cards use a true
  minus (`−€522.25`). Pick U+2212 everywhere in `format-money.ts`.
- **The account group header's collapse control is a `<` chevron**, which reads as "back", not
  "collapse". Use a rotating `v`.
- **The sync strip is permanent on mobile** — a full-width row saying "Synced" at all times. Show it
  on change and on error; fade it when idle.
- **Nested scroll areas**: `DataTable` is a fixed `h-[600px]` scroller inside a scrolling page. On a
  phone this means two scrollbars in one gesture region.
- **The bottom nav has icons only** with no labels, while the desktop navbar has both. Five icons
  with no text is a memory test; labels fit at 390px.
- **The transaction dialog is a centred modal on mobile** (442px tall, floating at y=201). A bottom
  sheet is the phone idiom and survives the keyboard opening.

---

## Visual direction (a separate, optional track)

Everything above is correctness and legibility, and stands on its own. This section is about
identity, and is worth doing only if you want the app to look like _something_ rather than like a
starter template. Right now it's the default: Tailwind blue on near-white, system sans throughout,
uniform 2xl radii, gradient cards.

**The thesis: this app is about runway, not budgets.** The currency list
(`USD, GEL, BYN, KZT, RUB, TRY, EUR, UZS`) says exactly who this is for — someone living across
currencies, who cares less about "did I overspend on groceries" than about **how long the money
lasts**. That's the number the design should be built around.

### Tokens

| Role               | Value                  | Why                                                                                    |
| ------------------ | ---------------------- | -------------------------------------------------------------------------------------- |
| `--color-ink`      | `oklch(0.19 0.02 250)` | Near-black with a cold cast, for text and the runway bar                               |
| `--color-paper`    | `oklch(0.97 0.006 90)` | Off-white with a warm tick, not cream — paper, not parchment                           |
| `--color-accent`   | `oklch(0.52 0.09 195)` | Verdigris. Not the default blue, not acid green; reads as neither "bank" nor "startup" |
| `--color-hold`     | `oklch(0.72 0.13 70)`  | Ochre, for savings and money held back                                                 |
| `--color-spend`    | `oklch(0.55 0.16 25)`  | Brick, less shrill than the current `--color-danger` red                               |
| `--color-graphite` | `oklch(0.55 0.01 250)` | Transfers — movement that isn't spending                                               |

Deliberately **not** the three looks that generative design keeps landing on (cream + serif +
terracotta; near-black + acid accent; hairline broadsheet). Verdigris/ochre on warm paper is closer to
ledger stock and stamped receipts, which is the subject's own world.

### Type

- **Display** — one characterful grotesque used only at 32px+ for the runway figure and page titles.
  `Bricolage Grotesque` (variable, tight, slightly odd) earns its place; the body face carrying
  headings is what makes an app read as templated.
- **Body** — `Inter`, which is effectively what's there now. Keep it. It should be invisible.
- **Money** — a tabular mono for every figure (`IBM Plex Mono` or `Geist Mono`). The app already
  uses `tabular-nums` and mono in places; make it a rule, self-hosted and digit-subset, since the app
  must work offline.

### Signature element: the runway ribbon

One memorable thing, on the dashboard, that no other tracker has: a horizontal ribbon from today to
the date the money runs out, segmented by month, with each account's contribution stacked into it and
the depletion date labelled at the end.

```
┌────────────────────────────────────────────────────────────────┐
│  RUNWAY                                                        │
│  3 months 11 days                            empty 24 Nov 2026 │
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░  │
│  │ Aug        │ Sep        │ Oct        │ Nov ╵                │
│  $12,091.72 across 3 accounts  ·  spending $116.43 / day       │
└────────────────────────────────────────────────────────────────┘
┌───────────────────────────┐  ┌───────────────────────────┐
│ THIS MONTH                │  │ ACCOUNTS                  │
│ spent  $1,842   ▁▃▅▂▇▃▁   │  │ Millennium    $7,094.07   │
│ in     $5,400             │  │ Revolut EUR    −€522.25   │
│ net    +$3,558            │  │ Savings       $5,600.00   │
└───────────────────────────┘  └───────────────────────────┘
```

Everything else stays quiet: one accent, one display face, generous space. The ribbon is the only
place the design raises its voice, and it shrinks to a 4px strip under the navbar on other routes so
the number follows you without repeating itself.

---

## Sequence

**Phase 1 — defects.** ~~Items 1, 2, 4~~ done, along with item 3, which came along with them because
the base-text-colour defect it exposed made the app unreadable after dark. Item 7 (the missing
`aria-label`s) is the remainder and belongs with phase 2.

**Phase 2 — mobile (1–2 days).** Items 5, 6, 8, 9, 10. A card list below `sm`, day headers instead of
trailing summaries, larger targets, and shorter cards. This is where the app changes most.

**Phase 3 — information (2–3 days).** Items 11, 12, 13, 14, 15, 16. A dashboard worth landing on, a
category breakdown, search, honest chart bounds, and the copy pass.

**Phase 4 — theming (design time).** The dark tokens are in, so what's left here is the visual
direction, if you want it. Anything that changes the palette now has two themes to satisfy.

## Not verified

- Only Chromium. Safari on a real iPhone will differ, particularly `min-h-dvh` with the URL bar and
  the position of the fixed bottom nav.
- Keyboard-only navigation and screen-reader flow were spot-checked (accessible names, target sizes)
  but not walked end to end.
- No performance profiling: the 241-row table scrolled smoothly, but that's a small dataset for a
  virtualiser and says nothing about 10,000 rows.
- The review ran against a seeded profile whose accounts were created by the CSV importer, so account
  _types_ are all `CURRENT` and the savings grouping on `/accounts` was never exercised with a real
  `SAVING` account.
