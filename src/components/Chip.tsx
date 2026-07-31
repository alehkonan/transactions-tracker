import { twMerge } from "tailwind-merge";
import type { ComponentProps } from "react";

type Props = ComponentProps<"span">;

export function Chip({ className, ...props }: Props) {
  return (
    <span
      className={twMerge(
        "bg-surface border-border rounded-full border px-2 py-0.5 text-sm",
        className,
      )}
      {...props}
    />
  );
}
