import { useRouter } from "@tanstack/react-router";
import { LogOutIcon } from "lucide-react";
import { useState } from "react";
import { signOut } from "~/api/auth.functions";
import { Button } from "~/components/Button";
import { resetLocalData } from "~/modules/sync/sync-engine";

export function SignOutButton() {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  const handleSignOut = async () => {
    setIsPending(true);
    try {
      await signOut();
      // Signing out on a shared device has to take the local copy of the data with it: the rows sit
      // in IndexedDB, readable by whoever uses the browser next. A session that merely expires keeps
      // them, so coming back is still instant.
      await resetLocalData();
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
