---
name: base-ui
description: Condensed reference for Base UI (base-ui.com/react), the unstyled/accessible React component library from the Radix/Floating UI/MUI authors — installation, the render/useRender/mergeProps composition model, styling via data-attributes, form integration, and anatomy for Dialog, Select, Combobox, Menu, Popover, Toast. Activate when adding, styling, or composing Base UI components, or when deciding whether a hand-rolled component in src/components/ (Dialog, Select, …) should wrap a Base UI primitive instead.
---

# Base UI (`@base-ui/react`)

Not currently a dependency of this repo — `src/components/` (`Button`, `Dialog`, `Select`, …) is hand-rolled. Reach for this
skill when adding a new interactive primitive (Combobox, Menu, Toast, Popover, …) that doesn't exist yet, or when evaluating
whether an existing hand-rolled component should be rebuilt on a Base UI primitive for free accessibility/keyboard/focus
handling. If adopted, components still get wrapped in this repo's own `src/components/*.tsx` file per the
`project-structure` skill — Base UI supplies the unstyled behavior, this repo supplies the styling with design tokens
(`bg-accent`, `border-border`, etc. — see main `CLAUDE.md`) and `twMerge`/`twJoin`.

Source: https://base-ui.com/react (condensed, not verbatim).

## Install

```bash
pnpm add @base-ui/react
```

Add `isolation: isolate;` to the root element's CSS (stacking-context requirement for portaled popups/overlays). Tree-shakable
— bundle only contains components actually imported.

## Composition model

Every part is unstyled and accepts `className`, `style`, and a `render` prop to swap the rendered element/component:

```tsx
<Menu.Item render={<a href="/foo" />}>Add to Library</Menu.Item>

// function form — access internal state, full control over prop spreading:
<Switch.Thumb render={(props, state) => <span {...props}>{state.checked ? <On /> : <Off />}</span>} />
```

A custom `render` component/element **must forward `ref` and spread all received props** onto its DOM node.

**`useRender`** — build your own primitive with the same `render`-prop pattern:

```tsx
import { useRender } from "@base-ui/react/use-render";
import { mergeProps } from "@base-ui/react/merge-props";

interface TextProps extends useRender.ComponentProps<"p"> {}

function Text({ render, ...props }: TextProps) {
  return useRender({
    defaultTagName: "p",
    render,
    props: mergeProps<"p">({ className: "text" }, props),
  });
}
```

**`mergeProps`** — combine internal + user props when using the function form of `render` (props aren't auto-merged there);
handles `className`/`style`/event-handler merging, and lets user handlers call `event.preventBaseUIHandler()` to cancel
Base UI's own handling:

```tsx
const getToggleProps = (props) =>
  mergeProps(props, {
    onClick(event) {
      if (locked) event.preventBaseUIHandler();
    },
  });

<Toggle
  render={(props, state) => (
    <button {...getToggleProps(props)}>{state.pressed ? "❤️" : "🤍"}</button>
  )}
/>;
```

## Styling

No default styles. Three hooks to style off of:

- **`className`** — static or a function of state: `className={(state) => twJoin('...', state.open && 'ring-2')}`.
- **Data attributes** — state exposed as `[data-checked]`, `[data-open]`, `[data-disabled]`, etc.; style purely in CSS/Tailwind
  with no JS: `data-[open]:opacity-100`.
- **CSS variables** — positioning/sizing state exposed as vars like `--anchor-width`, `--available-height` for popups.

Works with plain CSS, CSS Modules, Tailwind utility classes directly on parts, or CSS-in-JS (`styled(Menu.Trigger)`).

## TypeScript

Namespaced types per part:

- `Component.Part.Props` — full prop type, for wrapper components: `function MyTooltip(props: Tooltip.Root.Props) { ... }`.
- `Component.Part.State` — internal state shape (e.g. positioner `open`/`side`/`align`/`anchorHidden`), for the function form
  of `render`.
- `Component.Root.ChangeEventDetails` / `ChangeEventReason` — shape/cause of `onValueChange`/`onOpenChange` callbacks.
- `Component.Root.Actions` — imperative methods via an `actionsRef` prop, where supported.

## Forms

Pass `name` to `Field.Root` to include the wrapped control's value on native form submit; supports native constraint
validation (`required`, `minLength`, `pattern`, `step`, …) via a hidden input. `Field.Error` renders validation messages;
pass server-side errors via the `errors` prop (merges with client-side state).

- **React Hook Form** — wrap with `<Controller>`, forward `field.{name,value,onChange,onBlur}` and
  `fieldState.{invalid,isTouched,isDirty,error}` into `Field.Root`/the control.
- **TanStack Form** — use `<form.Field>`, forward `field.state.meta.{isValid,isDirty}` into `Field.Root`.

## Component anatomy quick-reference

Every component follows `Root` → (`Portal` →) `Positioner`/`Viewport` → `Popup`, with `Trigger` outside the portal. Full
subpart list is on each component's page; the common ones:

**Dialog** — `Root` (`open`, `onOpenChange`, `modal: boolean | 'trap-focus'`, `defaultOpen`, `disablePointerDismissal`) →
`Trigger` → `Portal` → `Backdrop` + `Viewport` → `Popup` → `Title` / `Description` / `Close`.

```tsx
<Dialog.Root>
  <Dialog.Trigger>Open</Dialog.Trigger>
  <Dialog.Portal>
    <Dialog.Backdrop />
    <Dialog.Popup>
      <Dialog.Title>Title</Dialog.Title>
      <Dialog.Description>Body</Dialog.Description>
      <Dialog.Close>Close</Dialog.Close>
    </Dialog.Popup>
  </Dialog.Portal>
</Dialog.Root>
```

**Select** — `Root` (`items`, `value`, `onValueChange`, `multiple`, `defaultValue`, `disabled`, `open`) → `Label` →
`Trigger` (`Value` + `Icon`) → `Portal` → `Positioner` → `Popup` → `List` → `Item` (`ItemText`, `ItemIndicator`),
optionally grouped (`Group`/`GroupLabel`) or separated (`Separator`).

**Combobox** — like Select plus a text `Input`/`InputGroup`, `Clear`, multi-select `Chips`/`Chip`/`ChipRemove`, and
`Empty`/`Status` for no-results/loading states. `List` takes a render-function child: `{(item) => <Combobox.Item .../>}`.

**Menu** — `Root` → `Trigger` → `Portal` → `Positioner` (`sideOffset`) → `Popup` → `Item` / `LinkItem` / `Separator` /
`Group`+`GroupLabel` / `CheckboxItem`+`CheckboxItemIndicator` / `RadioGroup`+`RadioItem`+`RadioItemIndicator`, nested menus
via `SubmenuRoot`+`SubmenuTrigger`.

**Popover** — same shape as Dialog but non-modal by default: `Root` → `Trigger` → `Portal` → `Positioner` → `Popup` →
`Title`/`Description`.

**Toast** — `Provider` (wraps the tree) → `Portal` → `Viewport` → `Root` (per-toast, takes a `toast` object) → `Content` →
`Title`/`Description`/`Action`/`Close`. Trigger imperatively via the `Toast.useToastManager()` hook (`add`, `update`,
`close`, `promise`), not by rendering a toast component directly:

```tsx
const toastManager = Toast.useToastManager();
toastManager.add({ description: "Saved." });
```
