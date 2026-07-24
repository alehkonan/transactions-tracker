import { twMerge } from "tailwind-merge";
import type { ComponentProps } from "react";

type ButtonProps = ComponentProps<"button"> & {
  variant: "primary" | "secondary";
};

export function Button({ variant, className, ...props }: ButtonProps) {
  return (
    <button
      className={twMerge(
        className,
        "inline-flex gap-1 rounded-2xl px-3 py-1.5",
        "transition-shadow not-disabled:hover:shadow",
        variant === "primary" && "bg-accent text-surface disabled:bg-accent-muted",
        variant === "secondary" &&
          "bg-surface text-text border-border disabled:bg-surface-muted border",
      )}
      {...props}
    />
  );
}
