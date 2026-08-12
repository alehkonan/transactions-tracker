import { twJoin } from "tailwind-merge";
import { useSyncStore } from "./useSyncStore";

/**
 * Says that transactions are still arriving, and how far along they are.
 *
 * The app opens on the reference data alone, so for the first moment of a cold start every figure
 * derived from transactions — balances, day totals, statistics — is a partial sum that keeps
 * climbing. This is what keeps that honest instead of presenting a number that is about to change as
 * if it were final.
 *
 * Sits opposite the `Navbar` at both breakpoints (it moves from the bottom to the top on `md`), so
 * the two never overlap, and shares the navbar's `z-navbar` tier — it is the same kind of app chrome.
 * The wrapper stays `pointer-events-none` so it never swallows a tap meant for what it floats over.
 */
export function SyncProgress() {
  const pending = useSyncStore((state) => state.pending);
  const synced = useSyncStore((state) => state.syncedRows);
  const total = useSyncStore((state) => state.syncTotalRows);

  if (!pending.includes("transactions")) return null;

  // One guarded value rather than a percentage plus a separate null check: the backlog is only known
  // once the run's first page has landed, and until then there is nothing to be a percentage of.
  //
  // Capped below 100 while a page is still outstanding — rows written during the run make the count
  // overshoot a backlog measured at its start, and "100%" with the bar still spinning reads as stuck.
  const progress =
    total != null && total > 0
      ? {
          percent: Math.min(99, Math.floor((synced / total) * 100)),
          label: `${synced.toLocaleString()} / ${total.toLocaleString()}`,
        }
      : null;

  return (
    <div
      aria-live="polite"
      className={twJoin(
        "pointer-events-none fixed inset-x-0 flex justify-center p-3",
        "z-navbar top-0 md:top-auto md:bottom-0",
      )}
    >
      <div
        className={twJoin(
          "bg-surface border-border text-text-muted",
          "flex items-center gap-2.5 rounded-full border px-3 py-1.5 text-xs shadow",
        )}
      >
        <span>Syncing transactions</span>
        {progress == null ? (
          <span className="font-mono">{synced.toLocaleString()}</span>
        ) : (
          <>
            <span className="bg-surface-muted h-1.5 w-16 overflow-hidden rounded-full">
              <span
                className="bg-accent block h-full rounded-full transition-[width] duration-300"
                style={{ width: `${progress.percent}%` }}
              />
            </span>
            <span className="text-text font-mono font-medium">{progress.percent}%</span>
            {/* The exact counts are a detail — dropped on narrow screens, where the pill would
                otherwise run the full width of the viewport. */}
            <span className="hidden font-mono sm:inline">{progress.label}</span>
          </>
        )}
      </div>
    </div>
  );
}
