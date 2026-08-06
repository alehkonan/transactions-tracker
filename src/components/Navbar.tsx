import {
  ChartNoAxesCombinedIcon,
  LayoutDashboardIcon,
  ReceiptTextIcon,
  SettingsIcon,
  WalletIcon,
} from "lucide-react";
import { type JSX } from "react";
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
    to: "/",
    label: "Dashboard",
    icon: <LayoutDashboardIcon className="size-6" />,
  },
  {
    to: "/accounts",
    label: "Accounts",
    icon: <WalletIcon className="size-6" />,
  },
  {
    to: "/transactions",
    label: "Transactions",
    icon: <ReceiptTextIcon className="size-6" />,
  },
  {
    to: "/statistics",
    label: "Statistics",
    icon: <ChartNoAxesCombinedIcon className="size-6" />,
  },
  {
    to: "/settings",
    label: "Settings",
    icon: <SettingsIcon className="size-6" />,
  },
];

export function Navbar() {
  return (
    <nav className="pointer-events-auto">
      <ul className={twJoin("bg-surface grid grid-flow-col-dense gap-1 rounded-2xl shadow")}>
        {navItems.map((link) => (
          <li key={link.to} className="p-0.5">
            <NavLink to={link.to} aria-label={link.label} icon={link.icon}>
              {link.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
