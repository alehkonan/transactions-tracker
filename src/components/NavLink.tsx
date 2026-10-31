import { Link, type LinkComponentProps } from "@tanstack/react-router";
import { twMerge } from "tailwind-merge";
import type { JSX } from "react/jsx-runtime";

type Props = Omit<LinkComponentProps, "children"> & {
  children: string;
  icon: JSX.Element;
};

export function NavLink({ children, className, icon, to, ...props }: Props) {
  return (
    <Link
      {...props}
      className="focus-visible:ring-accent block cursor-pointer rounded-lg focus-visible:ring-2 focus-visible:outline-none"
      to={to}
      activeOptions={{ exact: to === "/" }}
    >
      {({ isActive }) => {
        return (
          <span
            className={twMerge(
              className,
              "flex h-16 min-w-0 flex-col items-center justify-center gap-1 px-1",
              isActive
                ? "text-accent border-accent border-t-2 font-bold"
                : "text-text-muted border-t-2 border-transparent",
            )}
          >
            {icon}
            <span className="max-w-full truncate text-xs leading-none font-semibold md:text-sm md:leading-normal">
              {children}
            </span>
          </span>
        );
      }}
    </Link>
  );
}
