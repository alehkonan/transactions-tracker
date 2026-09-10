import { twMerge } from "tailwind-merge";
import type { ComponentProps } from "react";

type SelectOption = {
  value: string;
  label: string;
};

type Props = Omit<
  ComponentProps<"select">,
  "children" | "defaultValue" | "multiple" | "onChange" | "value"
> & {
  /** Plain strings are used as both the value and the label. */
  options: SelectOption[] | string[];
  /** Selectable empty option; disable it for required pick-one fields. */
  placeholder?: string;
  placeholderDisabled?: boolean;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string | undefined) => void;
};

/** Native single-select with the app's control styling. */
export function Select({
  options,
  placeholder,
  placeholderDisabled,
  value,
  defaultValue,
  onValueChange,
  className,
  ...props
}: Props) {
  const normalized: SelectOption[] = options.map((option) =>
    typeof option === "string" ? { value: option, label: option } : option,
  );
  const isControlled = value !== undefined || onValueChange !== undefined;

  return (
    <select
      {...props}
      {...(isControlled ? { value: value ?? "" } : { defaultValue: defaultValue ?? "" })}
      onChange={(event) => onValueChange?.(event.currentTarget.value || undefined)}
      className={twMerge(
        "border-border bg-surface text-text h-11 min-w-0 rounded-2xl border px-3 sm:h-9",
        "transition-[box-shadow,background-color,color,border-color] not-disabled:hover:shadow",
        "focus-visible:ring-accent focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
        "disabled:bg-surface-muted disabled:cursor-not-allowed",
        className,
      )}
    >
      {placeholder !== undefined && (
        <option value="" disabled={placeholderDisabled}>
          {placeholder}
        </option>
      )}
      {normalized.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
