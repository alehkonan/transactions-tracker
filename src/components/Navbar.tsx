import { useRouter, useRouterState } from "@tanstack/react-router";
import { ChartNoAxesCombinedIcon, ReceiptTextIcon, SettingsIcon, WalletIcon } from "lucide-react";
import { useEffect, useRef, type JSX, type MouseEvent } from "react";
import { twJoin } from "tailwind-merge";
import { NavLink } from "./NavLink";
import type { FileRouteTypes } from "~/routeTree.gen";

type NavItem = {
  to: FileRouteTypes["fullPaths"];
  label: string;
  icon: JSX.Element;
};

const navItems: NavItem[] = [
  {
    to: "/accounts",
    label: "Money",
    icon: <WalletIcon className="size-5 md:size-6" />,
  },
  {
    to: "/transactions",
    label: "Transactions",
    icon: <ReceiptTextIcon className="size-5 md:size-6" />,
  },
  {
    to: "/statistics",
    label: "Statistics",
    icon: <ChartNoAxesCombinedIcon className="size-5 md:size-6" />,
  },
  {
    to: "/settings",
    label: "Settings",
    icon: <SettingsIcon className="size-5 md:size-6" />,
  },
];

export function Navbar() {
  const router = useRouter();
  const { pathname, search } = useRouterState({ select: (state) => state.location });
  const savedSearches = useRef<Record<string, typeof search>>({});
  useEffect(() => {
    if (navItems.some((item) => item.to === pathname)) savedSearches.current[pathname] = search;
  }, [pathname, search]);
  const openTab = async (
    event: MouseEvent<HTMLAnchorElement>,
    to: NavItem["to"],
    tabSearch: typeof search,
  ) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    await router.navigate({ to, search: tabSearch });
    if (router.state.location.pathname === to) {
      document
        .querySelectorAll("[data-tab-scroll]")
        .forEach((element) => element.scrollTo({ top: 0, left: 0, behavior: "instant" }));
    }
  };
  return (
    <nav
      aria-label="Main navigation"
      className="bg-surface border-border w-full border-t pb-[env(safe-area-inset-bottom)]"
    >
      <ul className={twJoin("mx-auto grid w-full max-w-2xl grid-cols-4 gap-1 px-2")}>
        {navItems.map((link) => (
          <li key={link.to} className="min-w-0">
            <NavLink
              to={link.to}
              search={pathname === link.to ? search : (savedSearches.current[link.to] ?? {})}
              onClick={(event) =>
                void openTab(
                  event,
                  link.to,
                  pathname === link.to ? search : (savedSearches.current[link.to] ?? {}),
                )
              }
              data-testid={`nav${link.to.replaceAll("/", "-")}`}
              aria-label={link.label}
              icon={link.icon}
            >
              {link.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
