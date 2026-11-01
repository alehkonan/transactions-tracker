import { createFileRoute } from "@tanstack/react-router";
import { TransactionsImportScreen } from "~/screens/TransactionsImportScreen";

export const Route = createFileRoute("/_client/transactions-import")({
  component: TransactionsImportScreen,
});
