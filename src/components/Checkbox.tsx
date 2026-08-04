import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox";
import { CheckIcon, MinusIcon } from "lucide-react";
import { twMerge } from "tailwind-merge";

type CheckboxProps = {
  checked?: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  className?: string;
};

/** Checkbox styled to match the `Button` secondary variant. */
export function Checkbox({
  className,
  indeterminate = false,
  checked,
  disabled,
  onCheckedChange,
}: CheckboxProps) {
  return (
    <BaseCheckbox.Root
      checked={checked}
      indeterminate={indeterminate}
      disabled={disabled}
      onCheckedChange={onCheckedChange}
      className={twMerge(
        "border-border bg-surface grid size-5 shrink-0 place-items-center rounded-md border transition-shadow",
        "focus-visible:ring-accent focus-visible:ring-2 focus-visible:ring-offset-2",
        disabled ? "cursor-not-allowed" : "cursor-pointer",
        !disabled && "hover:shadow",
        "data-[checked]:bg-accent data-[checked]:border-accent",
        "data-[indeterminate]:bg-accent data-[indeterminate]:border-accent",
        disabled && "bg-surface-muted",
        className,
      )}
    >
      <BaseCheckbox.Indicator className="text-surface flex">
        {indeterminate ? <MinusIcon size={14} /> : <CheckIcon size={14} />}
      </BaseCheckbox.Indicator>
    </BaseCheckbox.Root>
  );
}
