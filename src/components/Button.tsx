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
        "inline-flex h-9 items-center justify-center gap-1 rounded-2xl px-3",
        "transition-[box-shadow,background-color,color,border-color] not-disabled:hover:shadow",
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
