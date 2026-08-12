---
name: z-index-system
description: This repo's single global z-index scale, defined once in src/styles.css under @theme (--z-index-*) and consumed via generated z-* utility classes (z-navbar, z-dropdown, z-dialog, ...) — never a raw z-10/z-50 or an inline zIndex number. Activate before adding any new z-index, stacking, `position: fixed/sticky/absolute` overlay, or troubleshooting an element rendering behind something it shouldn't.
---

# z-index system (transactions-tracker)

Every stacking-order number in this app comes from one place: the `--z-index-*` tokens in `src/styles.css`'s
`@theme` block. Tailwind v4's `z-*` utility reads its values from the `--z-index` theme namespace (like `--color-*`
powers `bg-accent`/`text-accent`), so each token automatically becomes a class: `--z-index-navbar: 20` gives you
`z-navbar`.

## The rule

**Before adding any z-index anywhere in `src/` — a new `z-*` class, an inline `style={{ zIndex: ... }}`, or a `position:
fixed/sticky/absolute` element that might need one — open `src/styles.css` first and check the existing scale.**

- If the element fits an existing tier (see table below), use that tier's class (`z-dropdown`, `z-dialog`, ...).
  Don't invent a new number for "just this one dropdown."
- If it genuinely doesn't fit (a new category of global chrome), add a new `--z-index-<name>` token to the scale in
  `styles.css`, in the right ascending position, with a one-line comment — don't hardcode a bare number in a
  component.
- If the stacking is **local** to one component (e.g. a card deck, a custom layered widget) and never needs to
  compete with anything outside that component, wrap its container in `isolate` (`isolation: isolate`) so its
  internal z-index numbers can't leak into the global scale — see `AccountGroupSection.tsx`'s collapsed stack. Inside
  an `isolate`d container you can use small local numbers (or the `stack` tier as a base) freely, since they're
  contained.

## Why this exists

Before this system, `AccountGroupSection`'s collapsed card-stack used an unbounded inline `zIndex: accounts.length -
index` with no containing stacking context. With enough archived accounts, that number exceeded `Menu`/`Select`'s
`z-10` and `Toaster`'s `z-50`, which are just raw Tailwind classes with no shared scale — so a dropdown menu opened
from a stacked card rendered _behind_ other cards, and the `fixed` mobile navbar (which had no z-index at all, i.e.
`z-index: auto`) lost to any descendant anywhere on the page with a positive z-index, including that same runaway
stack. Two unrelated-looking bugs, one root cause: no shared scale, and no isolation around local stacking.

A later bug followed the same shape: `Select`'s popup (`z-dropdown`, 30) rendered _behind_ an open `Dialog`
(`z-dialog`, 41), because a `Select` inside `AccountForm` inside the edit-account `Dialog` is portaled to `body` and
had a lower tier than the dialog it was triggered from. Floating popups anchored to a trigger must always outrank
any container their trigger might live in — including a `Dialog` — so `dropdown` now sits above `dialog` in the
scale, below only `toast`.

## The scale (ascending — higher wins)

| Token                       | Class               | Value | Used by                                                                                                                                                                  |
| --------------------------- | ------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--z-index-stack`           | `z-stack`           | 10    | Base for local, `isolate`d stacking (card decks, etc). Rarely referenced directly — components inside an `isolate` container usually just need small numbers below this. |
| `--z-index-navbar`          | `z-navbar`          | 20    | The fixed/sticky `Navbar` header in `__root.tsx`.                                                                                                                        |
| `--z-index-dialog-backdrop` | `z-dialog-backdrop` | 30    | `Dialog`'s backdrop.                                                                                                                                                     |
| `--z-index-dialog`          | `z-dialog`          | 31    | `Dialog`'s viewport/popup — above its own backdrop.                                                                                                                      |
| `--z-index-dropdown`        | `z-dropdown`        | 40    | Floating popups anchored to a trigger: `Select`, `Menu`, `Popover` positioners — above `dialog` since a trigger can live inside an open `Dialog`.                        |
| `--z-index-toast`           | `z-toast`           | 50    | `Toaster` — must outrank everything, including an open dialog.                                                                                                           |

Unlisted elements have no z-index (`auto`) and stack by normal DOM order — that's correct for the vast majority of
the app; only give something an explicit tier when it's `fixed`/`sticky`/`absolute` and has actually collided with
something else.

## Red flags to call out during review

- A bare `z-10`, `z-20`, `z-50`, etc. Tailwind class instead of a `z-<tier>` class from the table.
- An inline `style={{ zIndex: <number or expression> }}` outside an `isolate`d local-stack container.
- A new `position: fixed`/`sticky` element with no z-index class at all — decide whether it needs one from the scale.
- A local stacking effect (index-based `zIndex` in a `.map()`, a manual layering hack) without an `isolate` wrapper.
