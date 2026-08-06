---
name: daypicker
description: Condensed reference for DayPicker (daypicker.dev, package `@daypicker/react` — the author's own rename/successor of `react-day-picker`, same repo and API), an unstyled React calendar component. Covers install, selection modes (single/multiple/range), styling via `classNames`/the `UI` enum with no default CSS required, custom components (`Chevron`/`DayButton`/etc), caption and nav layouts, and this repo's own popover-based `DatePicker` wrapper. Activate whenever adding or modifying any date/date-range picker or calendar input, or touching `src/components/DatePicker.tsx`.
---

# @daypicker/react (daypicker.dev)

Source: https://daypicker.dev (condensed, not verbatim) plus the package's own shipped `.d.ts`/`.js` — verify the
installed major before trusting any online example (`npm view @daypicker/react version`; this repo is on 10.x).

`@daypicker/react` is, per its own README, "the preferred package name for DayPicker v10 and newer." It ships from
the same `gpbl/react-day-picker` monorepo as a one-line re-export (`export * from "react-day-picker"`) — same author,
same API, same types. `react-day-picker` still works identically; this repo installs `@daypicker/react` because
that's the name the current docs and examples use.

`src/components/DatePicker.tsx` is this repo's reference implementation — read it before starting new work with this
library. It wraps `<DayPicker>` in a native HTML `popover` panel, positioned entirely via CSS anchor positioning (see
"Input fields / popups" below); the library itself provides neither an input+popup widget nor a positioning helper.

## Install

```bash
pnpm add @daypicker/react
```

No CSS import is required. DayPicker ships a default stylesheet (`@daypicker/react/style.css`) but it's optional —
this repo never imports it and styles every element itself via `classNames` (see Styling).

## Core pattern

```tsx
import { useState } from "react";
import { DayPicker } from "@daypicker/react";

const [selected, setSelected] = useState<Date>();
<DayPicker mode="single" selected={selected} onSelect={setSelected} />;
```

`mode` is a discriminated union (`"single" | "multiple" | "range"`) that changes the shape of `selected`/`onSelect`:

| `mode`       | `selected` type          | `onSelect` receives      |
| ------------ | ------------------------ | ------------------------ |
| `"single"`   | `Date \| undefined`      | `Date \| undefined`      |
| `"multiple"` | `Date[] \| undefined`    | `Date[] \| undefined`    |
| `"range"`    | `DateRange \| undefined` | `DateRange \| undefined` |

Omitting `mode` disables built-in selection (`mode?: undefined`) — for fully custom behavior driven by `modifiers` +
`onDayClick` instead. Set `required: true` on any mode to disallow clearing a complete selection (narrows `selected`
to non-`undefined` in the types too).

## Range mode

```tsx
import { useState } from "react";
import { DayPicker, type DateRange } from "@daypicker/react";

const [range, setRange] = useState<DateRange>();
<DayPicker mode="range" selected={range} onSelect={setRange} />;
```

`DateRange = { from: Date | undefined; to?: Date | undefined }`. `{ from, to: undefined }` (only a start picked) is a
genuinely valid, half-open state — first click sets `from`, second sets `to`.

- `min` / `max` — minimum/maximum number of **days** spanned by the range (inclusive count, not nights).
- `excludeDisabled` — resets the range if it would come to include a `disabled` day.
- `resetOnSelect` — clicking after a complete range starts a fresh one instead of extending it.

## Styling — no default CSS needed

Every rendered element maps to a key in the `UI` enum (plus `SelectionState` for `selected`/`range_start`/
`range_middle`/`range_end`, and `DayFlag` for `today`/`outside`/`disabled`/`hidden`/`focused`). Pass a
`Partial<ClassNames>` keyed by those enum values — no need to cover every key:

```tsx
import { DayPicker, UI, SelectionState, DayFlag, type ClassNames } from "@daypicker/react";

const classNames: Partial<ClassNames> = {
  [UI.Day]: "group p-0.5 text-center",
  [UI.DayButton]: "rounded-full size-8 hover:bg-surface-muted group-data-[selected=true]:bg-accent",
  [SelectionState.range_middle]: "bg-accent/15",
  [DayFlag.hidden]: "invisible",
};
<DayPicker classNames={classNames} />;
```

**Gotcha:** selection state is only mirrored as a `data-*` attribute (`data-selected`, `data-today`, `data-outside`,
`data-disabled`, `data-focused`) on the `Day` cell (a `<td>`) — never on the `DayButton` inside it, and range-band
states (`range_start`/`range_middle`/`range_end`) have **no** `data-*` attribute at all, only the `SelectionState`
classNames key. So: put `group` in `classNames[UI.Day]` and use `group-data-[selected=true]:` on
`classNames[UI.DayButton]` for selected/today/outside styling, but style range bands directly via their
`SelectionState` key on the `Day` cell itself — there's no button-level hook for those.

`styles`/`modifiersStyles` (inline `CSSProperties`) and `modifiersClassNames` work the same way for your own custom
`modifiers` (e.g. a `weekend` matcher), keyed by the modifier's own name instead of a built-in enum.
`getDefaultClassNames()` (exported by the package) returns the default stylesheet's class names, for extending rather
than replacing them — this repo doesn't use it since it never loads that stylesheet.

## Custom components

`components` swaps individual rendered elements. Available keys: `Root`, `Months`, `Month`, `MonthCaption`,
`MonthGrid`, `Weekdays`, `Weekday`, `Weeks`, `Week`, `Day`, `DayButton`, `Nav`, `PreviousMonthButton`,
`NextMonthButton`, `Chevron`, `Dropdown`, `DropdownNav`, `MonthsDropdown`, `YearsDropdown`, `Select`, `Option`,
`CaptionLabel`, `Footer`, `WeekNumber`, `WeekNumberHeader`. Forward whatever props you don't touch — they carry
accessibility/keyboard-nav wiring. `DayButton`'s own default implementation, for example, focuses itself via a
`ref` + `useEffect` when `modifiers.focused` is true; a replacement that drops this loses keyboard day-navigation:

```tsx
import type { ChevronProps } from "@daypicker/react";
import { ChevronLeftIcon, ChevronRightIcon, ChevronDownIcon } from "lucide-react";

function Chevron({ orientation, className }: ChevronProps) {
  const Icon =
    orientation === "left"
      ? ChevronLeftIcon
      : orientation === "right"
        ? ChevronRightIcon
        : ChevronDownIcon;
  return <Icon className={className} />;
}
<DayPicker components={{ Chevron }} />;
```

`Chevron` is reused for the prev/next nav buttons (`orientation: "left" | "right"`) **and** the dropdown-caption's own
chevron (`orientation: "down"`) — handle all three orientations or the dropdown one renders nothing.

## Caption & nav layouts

- `captionLayout`: `"label"` (default, plain text) | `"dropdown"` (native `<select>` for both month and year) |
  `"dropdown-months"` | `"dropdown-years"`. Dropdown modes default `startMonth`/`endMonth` to 100 years back through
  the end of the current year — pass both explicitly for a different range.
- `navLayout` — **this one has a sharp edge**: leaving it unset does _not_ mean "no navigation," it means a
  different, legacy rendering path — a single floating `<nav>` (containing both prev/next buttons) rendered once
  before the month grid, styled only via `classNames[UI.Nav]`, meant to be absolutely-positioned over the caption by
  the _default stylesheet_ (which this repo doesn't load). Skip loading that stylesheet without setting `navLayout`
  and you get an unstyled, unpositioned nav bar with no visual relationship to the caption. Set it explicitly:
  - `"around"` — prev button, caption, next button rendered in that DOM order _inside_ `Month`, each individually
    styleable via `classNames[UI.PreviousMonthButton]`/`[UI.NextMonthButton]`. This is what lets you lay out a
    caption row yourself (e.g. a 3-column CSS grid on `classNames[UI.Month]`) — use this whenever you supply your own
    CSS instead of the default stylesheet.
  - `"after"` — buttons rendered after the caption instead of straddling it; tab order matches visual order.

## Input fields / popups

The library ships **no** input+popup or floating-positioning helper — `guides/input-fields` shows only two hand-rolled
patterns: an inline calendar synced to a text `<input>` via state, or a native `<dialog>` modal. There's no built-in
equivalent of react-datepicker's `customInput` + popper positioning.

### This repo's convention

`src/components/DatePicker.tsx` supplies the popup: a trigger `<button popoverTarget={id}>` and a
`<div popover="auto">` panel wrapping `<DayPicker>`. The native Popover API promotes the panel to the browser's top
layer, so it can never be clipped by an ancestor's `overflow`/`z-index`/stacking context (the previous
react-datepicker-based implementation had exactly that bug on narrow viewports, because its floating-ui positioning
never included a `shift` middleware).

Placement itself is pure CSS, no JS: associating a popover with its invoker (via `popovertarget`/`popoverTarget`)
creates an **implicit anchor reference** between the two — the invoker becomes the popover's anchor for CSS anchor
positioning, with no `anchor-name`/`position-anchor` needed. See the `.date-picker-panel` rule in `src/styles.css`:

```css
.date-picker-panel {
  position-area: bottom span-right; /* below the trigger, left edges aligned */
  position-try-fallbacks: flip-inline, flip-block; /* flip alignment/side if that overflows */
}
```

**Gotcha, verified by measuring `getBoundingClientRect()` in a live browser (see below) — don't trust the value name
alone:** a bare two-physical-keyword `position-area` like `bottom left` is **not** "below, left-aligned." It's a
diagonal _corner_ tile of the anchor's 3×3 grid — it places the popover entirely beside the anchor, touching only at
one corner (`bottom left` puts the popover's whole box to the anchor's _left_, i.e. `popover.right === anchor.left`,
which is what originally caused this component's calendar to jump away from its trigger toward the left edge of the
viewport). The edge-aligned placement people actually mean by "bottom-start" needs a **spanning** keyword instead:
`bottom span-right` — single-row placement (`bottom` = directly below, one row only), with the column spanning
outward from the anchor's own left edge, so `popover.left === anchor.left`. Verify any `position-area` choice by
measuring rects in a real browser rather than trusting what the keyword names sound like they should do.

`position-area` needs `margin: 0; inset: auto;` on the element to take effect (the default popover UA stylesheet sets
`inset: 0; margin: auto` to center it, which otherwise wins). The browser recomputes position on scroll/resize
automatically — no listeners needed, unlike a floating-ui/JS-measured approach. The one thing this doesn't give you
is floating-ui's "shift" (sliding to stay fully on-screen if even the flipped placement overflows) — CSS anchor
positioning has no equivalent (`position-try-fallbacks` tries whole alternate placements, it doesn't slide; at
extreme widths, e.g. a 320px viewport, the browser instead shrinks the popover to fit rather than repositioning it,
which can visually clip its content — narrower than any current real device, so treated as an accepted edge case
here). Reuse this pattern (implicit anchor + `position-area` + `position-try-fallbacks`) for any new popover in the
app instead of reaching for a JS positioning library — but verify the resulting rects in a browser, not just by
reading the CSS.
