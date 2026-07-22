import { Link } from "@tanstack/react-router";
import { HomeIcon, InfoIcon, ReceiptTextIcon } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import type { FileRouteTypes } from "~/routeTree.gen";

type NavLink = {
  to: FileRouteTypes["fullPaths"];
  label: string;
  icon: ReactNode;
};

const links: NavLink[] = [
  {
    to: "/",
    label: "Home",
    icon: <HomeIcon className="size-6 sm:size-4" />,
  },
  {
    to: "/transactions",
    label: "Transactions",
    icon: <ReceiptTextIcon className="size-6 sm:size-4" />,
  },
  {
    to: "/about",
    label: "About",
    icon: <InfoIcon className="size-6 sm:size-4" />,
  },
];

export function Navbar() {
  const navRef = useRef<HTMLElement>(null);

  // Publish the navbar's height as a CSS variable so <Page> can reserve the
  // matching top/bottom padding. A ResizeObserver keeps it in sync when the
  // navbar grows/shrinks across breakpoints.
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;

    const updateHeight = () => {
      document.documentElement.style.setProperty("--navbar-height", `${nav.offsetHeight}px`);
    };

    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(nav);
    return () => observer.disconnect();
  }, []);

  return (
    <nav
      ref={navRef}
      className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4 sm:top-4 sm:bottom-auto"
    >
      <ul className="flex items-center gap-1 rounded-full border-2 border-slate-800 bg-white shadow-lg dark:border-white dark:bg-slate-950">
        {links.map((link) => (
          <li key={link.to}>
            <Link
              to={link.to}
              aria-label={link.label}
              activeOptions={{ exact: link.to === "/" }}
              className="rounded-3xl"
            >
              {({ isActive, isTransitioning }) => {
                const active = isActive || isTransitioning;
                return (
                  <span
                    className={`flex items-center gap-2 rounded-full px-4 py-3 text-sm font-medium transition sm:px-4 sm:py-2 ${
                      active
                        ? "bg-slate-800 text-white dark:bg-white dark:text-slate-900"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
                    }`}
                  >
                    {link.icon}
                    <span className="hidden sm:inline">{link.label}</span>
                  </span>
                );
              }}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
