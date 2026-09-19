---
name: base-ui
description: Use only when creating any new UI component, or when modifying an existing component that already uses Base UI. For new components, require the user to choose between Base UI and a hand-written implementation before coding; do not activate for existing components that do not use Base UI.
---

# Base UI (`@base-ui/react`)

## New component: ask before coding

For every new UI component, ask the user to choose one option before implementation:

> Should this component use Base UI, or should it be implemented by hand?
>
> - **Base UI** — gains tested keyboard interaction, focus management, ARIA behavior, dismissal, and anchored/portaled positioning. Costs: adds or expands a dependency, introduces Base UI's compound-component API and DOM structure, and may be excessive for a simple native control.
> - **Hand-written** — keeps the component small, dependency-free, and fully controlled; usually best for simple controls that native HTML already handles well. Costs: the project owns all non-native keyboard behavior, focus management, ARIA state, dismissal, collision positioning, and accessibility testing.

Implement only the option the user selects. Wrap Base UI behavior in this repo's own component and style it with semantic design tokens.

## Examples

### Render a Base UI part as another element

```tsx
import { Menu } from "@base-ui/react/menu";

<Menu.Item render={<a href="/transactions/new" />}>Add transaction</Menu.Item>;
```

### Read component state from `render`

```tsx
import { Switch } from "@base-ui/react/switch";

<Switch.Thumb
  render={(props, state) => <span {...props}>{state.checked ? "Enabled" : "Disabled"}</span>}
/>;
```

### Merge internal and consumer props

```tsx
import { Toggle } from "@base-ui/react/toggle";
import { mergeProps } from "@base-ui/react/merge-props";

<Toggle
  render={(props, state) => (
    <button
      {...mergeProps(props, {
        className: state.pressed ? "bg-accent" : "bg-surface",
        onClick(event) {
          if (locked) event.preventBaseUIHandler();
        },
      })}
    >
      Favorite
    </button>
  )}
/>;
```

### Build a wrapper with `useRender`

```tsx
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";

interface TextProps extends useRender.ComponentProps<"p"> {}

function Text({ render, ...props }: TextProps) {
  return useRender({
    defaultTagName: "p",
    render,
    props: mergeProps<"p">({ className: "text-foreground" }, props),
  });
}
```

### Style state and popup geometry

```tsx
import { Popover } from "@base-ui/react/popover";

<Popover.Positioner className="w-[var(--anchor-width)]">
  <Popover.Popup className="border-border bg-surface data-[open]:opacity-100">
    Popover content
  </Popover.Popup>
</Popover.Positioner>;
```

### Integrate a Base UI control with React Hook Form

```tsx
import { Switch } from "@base-ui/react/switch";
import { Controller, useForm } from "react-hook-form";

function NotificationsField() {
  const { control } = useForm<{ notifications: boolean }>();

  return (
    <Controller
      name="notifications"
      control={control}
      render={({ field, fieldState }) => (
        <Switch.Root
          name={field.name}
          checked={field.value}
          onCheckedChange={field.onChange}
          onBlur={field.onBlur}
          aria-invalid={fieldState.invalid}
        >
          <Switch.Thumb />
        </Switch.Root>
      )}
    />
  );
}
```

### Compose an accessible dialog

```tsx
import { Dialog } from "@base-ui/react/dialog";

<Dialog.Root>
  <Dialog.Trigger>Delete transaction</Dialog.Trigger>
  <Dialog.Portal>
    <Dialog.Backdrop />
    <Dialog.Viewport>
      <Dialog.Popup>
        <Dialog.Title>Delete transaction?</Dialog.Title>
        <Dialog.Description>This action cannot be undone.</Dialog.Description>
        <Dialog.Close>Cancel</Dialog.Close>
        <button type="button">Delete</button>
      </Dialog.Popup>
    </Dialog.Viewport>
  </Dialog.Portal>
</Dialog.Root>;
```

### Show a toast imperatively

```tsx
import { Toast } from "@base-ui/react/toast";

function SaveButton() {
  const toastManager = Toast.useToastManager();

  return (
    <button type="button" onClick={() => toastManager.add({ description: "Saved." })}>
      Save
    </button>
  );
}
```
