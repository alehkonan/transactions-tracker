import { CloudOffIcon, RefreshCwIcon } from "lucide-react";
import { useEffect } from "react";
import { twJoin } from "tailwind-merge";
import { pushNow, useSyncStore } from "./useSyncStore";

/**
 * Says how many local writes have not reached the server yet, and warns before they can be lost.
 *
 * Writes land in the store and on disk before the network is ever involved, so the app is never
 * blocked on a push — but that also means "saved" and "saved everywhere" come apart, and this is
 * what keeps the difference visible rather than implied. Clicking it retries now instead of waiting
 * out the backoff.
 *
 * Sits with `SyncProgress`, which occupies the same corner during a pull; the two cannot both be up,
 * since a push runs to completion before the pull behind it starts.
 */
export function UnsyncedChanges() {
  const outboxCount = useSyncStore((state) => state.outboxCount);
  const isPushing = useSyncStore((state) => state.isPushing);

  // Safari evicts IndexedDB for a site that has not been installed after seven days, and a queued
  // write is the one thing here that exists nowhere else. Closing the tab is the moment it becomes
  // the user's problem rather than the sync engine's.
  useEffect(() => {
    if (outboxCount === 0) return;

    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [outboxCount]);

  if (outboxCount === 0) return null;

  return (
    <div
      aria-live="polite"
      className={twJoin(
        "pointer-events-none fixed inset-x-0 flex justify-center p-3",
        "z-navbar top-0 md:top-auto md:bottom-0",
      )}
    >
      <button
        type="button"
        onClick={() => void pushNow()}
        disabled={isPushing}
        className={twJoin(
          "bg-surface border-border text-text-muted pointer-events-auto",
          "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs shadow",
          "hover:text-text disabled:hover:text-text-muted",
        )}
      >
        {isPushing ? (
          <RefreshCwIcon className="size-3.5 animate-spin" />
        ) : (
          <CloudOffIcon className="size-3.5" />
        )}
        <span>
          {outboxCount.toLocaleString()} {outboxCount === 1 ? "change" : "changes"}{" "}
          {isPushing ? "saving…" : "not saved yet"}
        </span>
      </button>
    </div>
  );
}
