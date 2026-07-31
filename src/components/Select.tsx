import { useId, type ComponentProps } from "react";
import { twMerge } from "tailwind-merge";

export type SelectOption = {
  value: string;
  label: string;
};

type Props = ComponentProps<"select"> & {
  /** Plain strings are used as both the value and the label. */
  options: SelectOption[] | string[];
  /** Optional leading option with an empty value (e.g. a prompt). */
  placeholder?: string;
  placeholderDisabled?: boolean;
  /** Renders a `<label>` above the select, wired up via `htmlFor`/`id`. */
  label?: string;
};

export const Select = ({
  options,
  placeholder,
  placeholderDisabled,
  label,
  className,
  id,
  ...props
}: Props) => {
  const generatedId = useId();
  const selectId = id ?? generatedId;

  return (
    <div className="flex h-full flex-col gap-1">
      {label && (
        <label htmlFor={selectId} className="text-text text-sm font-bold">
          {label}
        </label>
      )}
      <select
        id={selectId}
        className={twMerge(
          "border-border bg-surface text-text flex-1 rounded-lg border px-2 py-1.5",
          className,
        )}
        {...props}
      >
        {placeholder !== undefined && (
          <option value="" disabled={placeholderDisabled}>
            {placeholder}
          </option>
        )}
        {options.map((option) => {
          const { value, label: optionLabel } =
            typeof option === "string" ? { value: option, label: option } : option;
          return (
            <option key={value} value={value}>
              {optionLabel}
            </option>
          );
        })}
      </select>
    </div>
  );
};
