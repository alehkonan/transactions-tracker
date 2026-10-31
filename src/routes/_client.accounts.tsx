import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { AccountsScreen } from "~/screens/AccountsScreen";

export const Route = createFileRoute("/_client/accounts")({
  validateSearch: z.object({
    status: z.enum(["ACTIVE", "ARCHIVED", "ALL"]).optional().catch("ACTIVE"),
    view: z.enum(["accounts", "purposes"]).optional().catch("accounts"),
  }),
  component: AccountsScreen,
});
