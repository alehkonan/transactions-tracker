import { twMerge } from "tailwind-merge";
import type { ComponentProps } from "react";

type ButtonProps = {
  variant: "primary" | "secondary" | "danger";
} & ComponentProps<"button">;

export function Button({ variant, className, type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={twMerge(
        // Taller on a phone than on a desktop: 44px is the thumb-sized target Apple and Material
        // both ask for, and 36px is what a pointer wants. Every control in the app follows this
        // pair — see `Select`, `InputControl` and the toggle groups.
        "inline-flex h-11 items-center justify-center gap-1 rounded-2xl px-3 sm:h-9",
        "transition-[box-shadow,background-color,color,border-color] not-disabled:hover:shadow",
        "focus-visible:ring-accent focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
        variant === "primary" && "bg-accent text-surface disabled:bg-accent-muted",
        variant === "secondary" &&
          "bg-surface text-text border-border disabled:bg-surface-muted border",
        variant === "danger" &&
          "bg-surface text-text border-border disabled:bg-surface-muted not-disabled:hover:border-danger not-disabled:hover:bg-danger not-disabled:hover:text-surface border",
        className,
      )}
      {...props}
    />
  );
}
