import { createFileRoute, redirect } from "@tanstack/react-router";
import { getSession } from "~/api/auth.functions";
import { LoginCard } from "~/modules/auth/LoginCard";

export const Route = createFileRoute("/login")({
  beforeLoad: async () => {
    // Someone arriving here with a live session has no business on the login page.
    if (await getSession()) throw redirect({ to: "/" });
  },
  component: () => (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <LoginCard />
      </div>
    </div>
  ),
});
