import { Link } from "@tanstack/react-router";
import type { ComponentProps } from "react";

type Variant = "primary" | "secondary";

const baseClasses =
  "inline-flex cursor-pointer items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold shadow-sm transition focus-visible:outline-2 focus-visible:outline-offset-2";

const variantClasses: Record<Variant, string> = {
  primary: "bg-indigo-600 text-white hover:bg-indigo-500 focus-visible:outline-indigo-600",
  secondary:
    "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700",
};

type ButtonProps = { variant?: Variant } & (
  | ({ to?: undefined } & ComponentProps<"button">)
  | ComponentProps<typeof Link>
);

export function Button({ variant = "primary", className, ...props }: ButtonProps) {
  const classes = `${baseClasses} ${variantClasses[variant]}${className ? ` ${className}` : ""}`;

  if (props.to !== undefined) {
    return <Link className={classes} {...props} />;
  }

  return <button type="button" className={classes} {...(props as ComponentProps<"button">)} />;
}
