import { type ComponentProps } from "react";
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

export const Select = ({
  options,
  placeholder,
  placeholderDisabled,
  className,
  ...props
}: Props) => {
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
};
