import { useRouter } from "@tanstack/react-router";
import { LogOutIcon } from "lucide-react";
import { useState } from "react";
import { signOut } from "~/api/auth.functions";
import { Button } from "~/components/Button";

export function SignOutButton() {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  const handleSignOut = async () => {
    setIsPending(true);
    try {
      await signOut();
      // Invalidating re-runs the root guard, which now finds no session and redirects to /login.
      await router.invalidate();
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Button variant="danger" onClick={handleSignOut} disabled={isPending}>
      <LogOutIcon className="size-4" />
      Sign out
    </Button>
  );
}
