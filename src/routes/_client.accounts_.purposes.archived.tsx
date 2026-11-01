import { createFileRoute } from "@tanstack/react-router";
import { ArchivedPurposesScreen } from "~/screens/ArchivedPurposesScreen";

export const Route = createFileRoute("/_client/accounts_/purposes/archived")({
  component: ArchivedPurposesScreen,
});
