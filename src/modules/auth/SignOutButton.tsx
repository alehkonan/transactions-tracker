import { Toast } from "@base-ui/react/toast";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { signOut } from "~/api/auth.functions";
import { Button } from "~/components/Button";
import { Popover } from "~/components/Popover";
import { PopoverConfirm } from "~/components/PopoverConfirm";
import { resetLocalData } from "~/modules/sync/sync-engine";
import { useSyncStore } from "~/modules/sync/useSyncStore";

export function SignOutButton() {
  const router = useRouter();
  const toastManager = Toast.useToastManager();
  const outboxCount = useSyncStore((state) => state.outboxCount);
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
    } catch {
      toastManager.add({
        description: "Could not sign out. Your local data remains on this device.",
      });
    } finally {
      setIsPending(false);
    }
  };

  const hasUnsyncedChanges = outboxCount > 0;
  const changeLabel = outboxCount === 1 ? "change" : "changes";
  const confirmationMessage = hasUnsyncedChanges
    ? `${outboxCount.toLocaleString()} unsynced ${changeLabel} exist only on this device. Signing out now permanently removes them along with the local copy.`
    : "Signing out removes this account’s local data from this browser. Data already on the server will download again after your next sign-in.";

  const confirmationTitle = hasUnsyncedChanges
    ? "Unsynced changes will be lost"
    : "Sign out on this device";

  return (
    <Popover
      aria-label={confirmationTitle}
      renderTrigger={({ onOpen }) => (
        <Button variant="danger" onClick={onOpen} disabled={isPending}>
          {isPending ? "Signing out…" : "Sign out"}
        </Button>
      )}
    >
      <PopoverConfirm
        title={confirmationTitle}
        message={confirmationMessage}
        confirmLabel={hasUnsyncedChanges ? "Sign out anyway" : "Sign out"}
        confirmVariant="danger"
        onConfirm={() => void handleSignOut()}
      />
    </Popover>
  );
}
