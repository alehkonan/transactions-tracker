import { Toast } from "@base-ui/react/toast";
import { useEffect } from "react";
import { clearConflicts, useSyncStore } from "./useSyncStore";

/**
 * Tells the user when one of their writes landed on top of a newer one.
 *
 * Conflict resolution is last-write-wins on the server clock, deliberately: this is a single user
 * with a few devices and, in practice, one writer at a time, so a merge UI would be a great deal of
 * machinery for a case that barely happens. What a push can still do is *notice* — every entry
 * carries the `updatedAt` the client last saw — and saying so is the whole of the response. The
 * change stands; the message is there so a surprise later has an explanation.
 */
export function SyncConflictToasts() {
  const conflicts = useSyncStore((state) => state.conflicts);
  const toastManager = Toast.useToastManager();

  useEffect(() => {
    if (conflicts.length === 0) return;

    toastManager.add({
      title: "Overwrote a newer change",
      description:
        conflicts.length === 1
          ? "One record had been changed elsewhere since this device last saw it. Your version was kept."
          : `${conflicts.length} records had been changed elsewhere since this device last saw them. Your versions were kept.`,
    });

    clearConflicts(conflicts);
  }, [conflicts, toastManager]);

  return null;
}
