import { Link } from "@tanstack/react-router";
import { ChartNoAxesCombinedIcon, LayoutDashboardIcon, ReceiptTextIcon } from "lucide-react";
import { type ReactNode } from "react";
import { twJoin } from "tailwind-merge";
import type { FileRouteTypes } from "~/routeTree.gen";

type NavItem = {
  to: FileRouteTypes["fullPaths"];
  label: string;
  icon: ReactNode;
};

const navItems: NavItem[] = [
  {
    to: "/",
    label: "Dashboard",
    icon: <LayoutDashboardIcon />,
  },
  {
    to: "/transactions",
    label: "Transactions",
    icon: <ReceiptTextIcon />,
  },
  {
    to: "/statistics",
    label: "Statistics",
    icon: <ChartNoAxesCombinedIcon />,
  },
];

export function Navbar() {
  return (
    <nav className="pointer-events-auto">
      <ul className="bg-surface grid grid-flow-col-dense gap-1 rounded-3xl shadow-lg">
        {navItems.map((link) => (
          <li key={link.to} className="p-0.5">
            <Link
              className="cursor-default"
              to={link.to}
              aria-label={link.label}
              activeOptions={{ exact: link.to === "/" }}
            >
              {({ isActive }) => {
                return (
                  <span
                    className={twJoin(
                      "flex items-center gap-2 rounded-3xl px-3 py-2",
                      isActive ? "text-surface bg-accent" : "text-text",
                    )}
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
