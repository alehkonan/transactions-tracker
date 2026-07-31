import { Link, type LinkComponentProps } from "@tanstack/react-router";
import { twMerge } from "tailwind-merge";
import type { JSX } from "react/jsx-runtime";

type Props = Omit<LinkComponentProps, "children"> & {
  children: string;
  icon: JSX.Element;
};

export function NavLink({ children, className, icon, to, ...props }: Props) {
  return (
    <Link {...props} className="cursor-default" to={to} activeOptions={{ exact: to === "/" }}>
      {({ isActive }) => {
        return (
          <span
            className={twMerge(
              className,
              "flex items-center gap-2 rounded-2xl px-3 py-2",
              isActive ? "text-surface bg-accent" : "text-text",
            )}
          >
            {icon}
            <span className="hidden sm:inline">{children}</span>
          </span>
        );
      }}
    </Link>
  );
}
