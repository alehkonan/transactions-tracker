import { createFileRoute } from "@tanstack/react-router";
import { PurposesScreen } from "~/screens/PurposesScreen";

export const Route = createFileRoute("/_client/accounts_/purposes_")({ component: PurposesScreen });
