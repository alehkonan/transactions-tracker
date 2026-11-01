import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { LoginScreen } from "~/screens/LoginScreen";

export const Route = createFileRoute("/_client/login")({
  validateSearch: z.object({ returnTo: z.string().optional() }),
  component: LoginScreen,
});
