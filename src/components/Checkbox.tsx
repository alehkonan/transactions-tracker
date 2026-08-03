import { CheckIcon, MinusIcon } from "lucide-react";
import { useEffect, useRef, type ComponentProps } from "react";
import { twMerge } from "tailwind-merge";

type CheckboxProps = {
  indeterminate?: boolean;
} & ComponentProps<"input">;

/** Checkbox styled to match the `Button` secondary variant. */
export function Checkbox({
  className,
  indeterminate = false,
  checked,
  disabled,
  ...props
}: CheckboxProps) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <label
      className={twMerge(
        "flex w-fit",
        disabled ? "cursor-not-allowed" : "cursor-pointer",
        className,
      )}
    >
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        className="peer sr-only"
        {...props}
      />
      <span
        className={twMerge(
          "border-border bg-surface grid size-5 shrink-0 place-items-center rounded-md border transition-shadow",
          "peer-focus-visible:ring-accent peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2",
          !disabled && "hover:shadow",
          (checked || indeterminate) && "bg-accent border-accent",
          disabled && "bg-surface-muted",
        )}
      >
        {indeterminate ? (
          <MinusIcon size={14} className="text-surface" />
        ) : checked ? (
          <CheckIcon size={14} className="text-surface" />
        ) : null}
      </span>
    </label>
  );
}
