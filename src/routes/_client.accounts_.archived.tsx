import { createFileRoute } from "@tanstack/react-router";
import { ArchivedAccountsScreen } from "~/screens/ArchivedAccountsScreen";

export const Route = createFileRoute("/_client/accounts_/archived")({
  component: ArchivedAccountsScreen,
});
