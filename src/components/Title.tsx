import { twMerge } from "tailwind-merge";

type Props = {
  children: string;
  variant: "page" | "card" | "section" | "tooltip";
  /** Merged over the variant, for the places a title has to shrink (e.g. a phone's stat strip). */
  className?: string;
};

const variantClasses = {
  page: "font-display text-3xl font-bold",
  card: "text-xl font-semibold",
  section: "text-sm font-bold",
  tooltip: "text-xs font-bold",
};

/**
 * Semantic heading/text helper. Page titles are `<h1>`, dialog and section titles are `<h2>`,
 * and tooltips/labels render as `<span>` so they can sit inside buttons without invalid markup.
 */
export function Title({ children, variant, className }: Props) {
  const classes = twMerge("text-text", variantClasses[variant], className);

  if (variant === "page") return <h1 className={classes}>{children}</h1>;
  if (variant === "tooltip") return <span className={classes}>{children}</span>;
  return <h2 className={classes}>{children}</h2>;
}
