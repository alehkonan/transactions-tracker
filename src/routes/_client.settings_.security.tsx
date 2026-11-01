import { createFileRoute } from "@tanstack/react-router";
import { SecurityScreen } from "~/screens/SecurityScreen";

export const Route = createFileRoute("/_client/settings_/security")({
  component: SecurityScreen,
});
