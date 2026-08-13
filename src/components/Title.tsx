import { twMerge } from "tailwind-merge";

type Props = {
  children: string;
  variant: "page" | "card" | "section" | "tooltip";
  /** Merged over the variant, for the places a title has to shrink (e.g. a phone's stat strip). */
  className?: string;
};

export function Title({ children, variant, className }: Props) {
  return (
    <p
      className={twMerge(
        "text-text",
        variant === "page" && "text-3xl font-bold",
        variant === "card" && "text-xl font-semibold",
        variant === "section" && "text-sm font-bold",
        variant === "tooltip" && "text-xs font-bold",
        className,
      )}
    >
      {children}
    </p>
  );
}
