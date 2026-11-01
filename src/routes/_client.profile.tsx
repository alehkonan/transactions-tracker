import { createFileRoute } from "@tanstack/react-router";
import { ProfilesScreen } from "~/screens/ProfilesScreen";

export const Route = createFileRoute("/_client/profile")({
  component: ProfilesScreen,
});
