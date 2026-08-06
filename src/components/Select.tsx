import { Select as BaseSelect } from "@base-ui/react/select";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { useState } from "react";
import { twMerge } from "tailwind-merge";

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
}: Props) {
  const normalized: SelectOption[] = options.map((option) =>
    typeof option === "string" ? { value: option, label: option } : option,
  );
  const items =
    !multiple && placeholder
      ? [{ value: PLACEHOLDER_VALUE, label: placeholder }, ...normalized]
      : normalized;
  const labelFor = (v: string) => normalized.find((option) => option.value === v)?.label ?? v;

  const withPlaceholder = (v: string | undefined) =>
    v ?? (placeholder ? PLACEHOLDER_VALUE : undefined);

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
      <BaseSelect.Trigger
        id={id}
        className={twMerge(
          "border-border bg-surface text-text flex h-9 items-center justify-between gap-2 rounded-lg border px-2",
          "transition-shadow hover:shadow",
          "data-disabled:cursor-not-allowed data-disabled:opacity-50",
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
      <BaseSelect.Portal>
        <BaseSelect.Positioner sideOffset={4} className="z-10">
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
