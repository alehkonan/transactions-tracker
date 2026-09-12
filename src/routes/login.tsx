import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { LoginCard } from "~/modules/auth/LoginCard";

export const Route = createFileRoute("/login")({
  validateSearch: z.object({ returnTo: z.string().optional() }),
  component: () => (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <LoginCard />
      </div>
    </div>
  ),
});
