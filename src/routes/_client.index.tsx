import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_client/")({
  beforeLoad: () => {
    throw redirect({ to: "/transactions" });
  },
});
