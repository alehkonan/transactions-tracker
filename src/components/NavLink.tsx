import { Link, type LinkComponentProps } from "@tanstack/react-router";
import { twMerge } from "tailwind-merge";
import type { JSX } from "react/jsx-runtime";

type Props = Omit<LinkComponentProps, "children"> & {
  children: string;
  icon: JSX.Element;
};

export function NavLink({ children, className, icon, to, ...props }: Props) {
  return (
    <Link {...props} className="cursor-pointer" to={to} activeOptions={{ exact: to === "/" }}>
      {({ isActive }) => {
        return (
          <span
            className={twMerge(
              className,
              "flex h-14 min-w-0 flex-col items-center justify-center gap-0.5 rounded-2xl px-1 md:h-10 md:flex-row md:gap-2 md:px-4",
              isActive ? "text-surface bg-accent" : "text-text",
            )}
          >
            {icon}
            <span className="max-w-full truncate text-xs leading-none font-semibold md:text-sm md:leading-normal md:font-normal">
              {children}
            </span>
          </span>
        );
      }}
    </Link>
  );
}
