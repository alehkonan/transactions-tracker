import { createFileRoute, redirect } from "@tanstack/react-router";
import { LoginCard } from "~/modules/auth/LoginCard";
import { hasLiveSessionHint } from "~/modules/auth/session-hint";

export const Route = createFileRoute("/login")({
  beforeLoad: () => {
    // Someone arriving here with a live session has no business on the login page.
    if (hasLiveSessionHint()) throw redirect({ to: "/" });
  },
  component: () => (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <LoginCard />
      </div>
    </div>
  ),
});
