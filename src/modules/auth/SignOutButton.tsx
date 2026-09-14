import { Toast } from "@base-ui/react/toast";
import { useState } from "react";
import { signOut } from "~/api/auth.functions";
import { Button } from "~/components/Button";
import { Popover } from "~/components/Popover";
import { PopoverConfirm } from "~/components/PopoverConfirm";
import {
  completeSignOut,
  readSignOutObligations,
  SignOutObligationsChangedError,
} from "~/modules/auth/complete-sign-in";
import { useSyncStore } from "~/modules/sync/useSyncStore";

export function SignOutButton({ label = "Sign out" }: { label?: string }) {
  const toastManager = Toast.useToastManager();
  const visibleOutboxCount = useSyncStore((state) => state.outboxCount);
  const [confirmedOutboxCount, setConfirmedOutboxCount] = useState<number | null>(null);
  const [isPending, setIsPending] = useState(false);

  const openConfirmation = async (onOpen: () => void) => {
    setIsPending(true);
    try {
      const obligations = await readSignOutObligations();
      setConfirmedOutboxCount(obligations.outboxCount);
      onOpen();
    } catch {
      toastManager.add({
        description: "Could not verify local changes. Sign-out was not started.",
      });
    } finally {
      setIsPending(false);
    }
  };

  const handleSignOut = async () => {
    setIsPending(true);
    try {
      await completeSignOut(() => signOut(), confirmedOutboxCount ?? visibleOutboxCount);
      window.location.assign("/login");
    } catch (error) {
      if (error instanceof SignOutObligationsChangedError) {
        setConfirmedOutboxCount(error.outboxCount);
        toastManager.add({
          description: "Local changes changed. Review the updated warning before signing out.",
        });
      } else {
        toastManager.add({
          description: "Could not sign out. Your local data remains on this device.",
        });
      }
    } finally {
      setIsPending(false);
    }
  };

  const outboxCount = confirmedOutboxCount ?? visibleOutboxCount;
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
        <Button variant="danger" onClick={() => void openConfirmation(onOpen)} disabled={isPending}>
          {isPending ? "Signing out…" : label}
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
