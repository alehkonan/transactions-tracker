import { type ComponentProps, memo } from "react";
import { twMerge } from "tailwind-merge";

export type SelectOption = {
  value: string;
  label: string;
};

type Props = ComponentProps<"select"> & {
  options: SelectOption[];
  /** Optional leading option with an empty value (e.g. a prompt). */
  placeholder?: string;
  placeholderDisabled?: boolean;
};

/**
 * Reusable styled `<select>`. Memoized so it only re-renders when its own props
 * change — pass a stable `options` reference and `onChange` to benefit from it.
 */
export const Select = memo(function Select({
  options,
  placeholder,
  placeholderDisabled,
  className,
  ...props
}: Props) {
  return (
    <select
      className={twMerge(
        "border-border bg-surface text-text rounded-lg border px-2 py-1.5",
        className,
      )}
      {...props}
    >
      {placeholder !== undefined && (
        <option value="" disabled={placeholderDisabled}>
          {placeholder}
        </option>
      )}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
});
