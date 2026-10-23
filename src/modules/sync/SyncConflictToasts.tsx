import { Toast } from "@base-ui/react/toast";
import { useEffect } from "react";
import { clearConflicts, useSyncStore } from "./useSyncStore";

/** Reports the actual acceptance outcome, including legacy edits rejected by fixed-currency rules. */
export function SyncConflictToasts() {
  const conflicts = useSyncStore((state) => state.conflicts);
  const toastManager = Toast.useToastManager();

  useEffect(() => {
    if (conflicts.length === 0) return;

    const applied = conflicts.filter((conflict) => conflict.classification === "intent-applied");
    if (applied.length > 0) {
      toastManager.add({
        title: "Overwrote a newer change",
        description:
          applied.length === 1
            ? "One record had been changed elsewhere since this device last saw it. Your version was kept."
            : `${applied.length} records had been changed elsewhere since this device last saw them. Your versions were kept.`,
      });
    }

    const rejected = conflicts.filter((conflict) => conflict.classification !== "intent-applied");
    if (rejected.length > 0) {
      const labels = [
        ...new Set(rejected.map((conflict) => conflict.presentationContext.entityLabel)),
      ];
      const accountHint = rejected.some((conflict) => conflict.table === "accounts")
        ? " An account's currency is fixed. Use another account for a different currency."
        : "";
      toastManager.add({
        title: "Some changes were not applied",
        description: `${labels.join(", ")}: the server state was kept. Review these records before editing again.${accountHint}`,
      });
    }

    clearConflicts(conflicts);
  }, [conflicts, toastManager]);

  return null;
}
