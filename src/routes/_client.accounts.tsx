import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";
import { AccountsScreen } from "~/screens/AccountsScreen";

export const Route = createFileRoute("/_client/accounts")({
  validateSearch: z.object({
    status: z.enum(["ACTIVE", "ARCHIVED", "ALL"]).optional().catch("ACTIVE"),
    view: z.enum(["accounts", "purposes"]).optional().catch("accounts"),
  }),
  beforeLoad: ({ search }) => {
    if (search.view === "purposes") throw redirect({ to: "/accounts/purposes", replace: true });
    if (search.status === "ARCHIVED") throw redirect({ to: "/accounts/archived", replace: true });
  },
  component: AccountsScreen,
});
