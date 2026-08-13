import { Select as BaseSelect } from "@base-ui/react/select";
import { CheckIcon, ChevronDownIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { twJoin, twMerge } from "tailwind-merge";

export type SelectOption = {
  value: string;
  label: string;
};

type SingleProps = {
  multiple?: false;
  value?: string;
  onValueChange?: (value: string | undefined) => void;
};

type MultipleProps = {
  multiple: true;
  value: string[];
  onValueChange: (value: string[]) => void;
};

type Props = (SingleProps | MultipleProps) & {
  /** Plain strings are used as both the value and the label. */
  options: SelectOption[] | string[];
  /** Selectable "no value" item (single-select only); picking it reports `undefined`. */
  placeholder?: string;
  id?: string;
  className?: string;
  /** Renders a hidden input so the selected value participates in native form submission. */
  name?: string;
  required?: boolean;
  /** Uncontrolled initial value (single-select only); ignored if `onValueChange` is passed. */
  defaultValue?: string;
  /**
   * Renders a small reset chip inside the trigger. Omit it (e.g. when nothing is selected) to
   * hide the chip entirely.
   */
  onReset?: () => void;
};

// Sentinel item id representing "no value selected" so the placeholder can be
// a real, re-selectable item in the popup rather than a special-cased value.
const PLACEHOLDER_VALUE = "__select_placeholder__";

export function Select({
  options,
  placeholder,
  id,
  className,
  multiple,
  value,
  defaultValue,
  onValueChange,
  name,
  required,
  onReset,
}: Props) {
  const normalized: SelectOption[] = options.map((option) =>
    typeof option === "string" ? { value: option, label: option } : option,
  );
  const items =
    !multiple && placeholder
      ? [{ value: PLACEHOLDER_VALUE, label: placeholder }, ...normalized]
      : normalized;
  const labelFor = (v: string) => normalized.find((option) => option.value === v)?.label ?? v;

  // An unset field arrives as `""` as often as `undefined` — react-hook-form's `useController`
  // reports the empty string — and `??` lets that through, leaving the value matching no item at
  // all, so the trigger renders blank instead of the placeholder.
  const withPlaceholder = (v: string | undefined) =>
    v || (placeholder ? PLACEHOLDER_VALUE : undefined);

  // Tracks the *reported* value (never the sentinel) when the caller doesn't control
  // this select itself, so uncontrolled usage still works like a normal form field.
  const [internalValue, setInternalValue] = useState(defaultValue);
  const reportedValue = onValueChange ? (value as string | undefined) : internalValue;

  const handleValueChange = (next: unknown) => {
    if (multiple) {
      onValueChange?.(next as string[]);
      return;
    }
    const nextValue = next as string;
    const reported = nextValue === PLACEHOLDER_VALUE ? undefined : nextValue;
    if (!onValueChange) setInternalValue(reported);
    onValueChange?.(reported);
  };

  return (
    <BaseSelect.Root
      items={items}
      multiple={multiple}
      required={required}
      // Multiple-select has no placeholder sentinel to translate, so it can submit
      // via Base UI's own `name`-bound hidden inputs directly; single-select renders
      // its own hidden input below instead, carrying the translated (non-sentinel) value.
      name={multiple ? name : undefined}
      value={(multiple ? value : withPlaceholder(reportedValue)) as never}
      onValueChange={handleValueChange}
    >
      {/* The chip sits on top of the trigger rather than inside it: nesting a button in a
          button is invalid HTML, and its click would also open the popup. */}
      <span className="relative inline-flex">
        <BaseSelect.Trigger
          id={id}
          // Matches Button's `secondary` variant so filters/triggers sit flush next to buttons.
          className={twMerge(
            // A minimum width so the trigger doesn't collapse around a short label, or resize
            // under the pointer as the selection changes.
            "inline-flex h-9 min-w-32 items-center justify-between gap-1 rounded-2xl px-3",
            "transition-[box-shadow,background-color,color,border-color] not-disabled:hover:shadow",
            "bg-surface text-text border-border disabled:bg-surface-muted border",
            "data-disabled:cursor-not-allowed",
            onReset && "pr-9",
            className,
          )}
        >
          <BaseSelect.Value className="truncate">
            {(selected: string | string[] | null) => {
              if (selected == null || (Array.isArray(selected) && selected.length === 0)) {
                return <span className="text-text-muted">{placeholder}</span>;
              }
              if (Array.isArray(selected)) {
                return selected.length === 1
                  ? labelFor(selected[0])
                  : `${labelFor(selected[0])} (+${selected.length - 1} more)`;
              }
              return selected === PLACEHOLDER_VALUE ? (
                <span className="text-text-muted">{placeholder}</span>
              ) : (
                labelFor(selected)
              );
            }}
          </BaseSelect.Value>
          <BaseSelect.Icon>
            <ChevronDownIcon className="size-4 shrink-0" />
          </BaseSelect.Icon>
        </BaseSelect.Trigger>
        {onReset && (
          <button
            type="button"
            onClick={onReset}
            aria-label="Reset selection"
            className={twJoin(
              "absolute top-1/2 right-2 -translate-y-1/2",
              "bg-surface-muted hover:bg-surface-active text-text-muted hover:text-text",
              "grid size-5 place-items-center rounded-full transition-colors",
            )}
          >
            <XIcon className="size-3" />
          </button>
        )}
      </span>
      <BaseSelect.Portal>
        <BaseSelect.Positioner sideOffset={4} className="z-dropdown">
          <BaseSelect.Popup className="border-border bg-surface text-text max-h-64 overflow-auto rounded-xl border p-1 shadow-lg">
            {items.map((item) => (
              <BaseSelect.Item
                key={item.value}
                value={item.value}
                className="data-highlighted:bg-surface-muted flex cursor-default items-center gap-2 rounded-lg px-2 py-1.5 text-sm"
              >
                <BaseSelect.ItemIndicator className="text-accent">
                  <CheckIcon className="size-4" />
                </BaseSelect.ItemIndicator>
                <BaseSelect.ItemText>{item.label}</BaseSelect.ItemText>
              </BaseSelect.Item>
            ))}
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
      {!multiple && name && (
        <input type="hidden" name={name} value={reportedValue ?? ""} readOnly />
      )}
    </BaseSelect.Root>
  );
}
