import {
  CloudAlertIcon,
  CloudCheckIcon,
  CloudOffIcon,
  CloudUploadIcon,
  RefreshCwIcon,
} from "lucide-react";
import { twJoin } from "tailwind-merge";
import { pushNow, syncNow } from "./sync-engine";
import { useSyncStore } from "./useSyncStore";
import type { SyncedTable } from "./sync-types";
import type { SyncStatus as Status } from "./useSyncStore";
import type { JSX } from "react";

/**
 * Where the data on screen stands with the server: synced, syncing, offline, or holding writes that
 * have not left this device.
 *
 * Every read is served from memory and every write lands locally first, which is what makes the app
 * quick — and also what makes "saved" and "saved everywhere" come apart. This is the one place that
 * keeps the difference visible rather than implied.
 *
 * Deliberately not part of the `Navbar`: the bar is already five destinations wide on a phone, and
 * this is not one of them. It takes the top edge instead, opposite the navigation at both
 * breakpoints (the navbar is at the bottom on a phone, centred at the top from `md` up).
 *
 * Two shapes, for the two amounts of room there are:
 *
 * - **Phone** — a strip across the full width, as short as a line of text can be. Edge to edge
 *   costs nothing there and buys the space to say the state in words rather than as an icon to be
 *   guessed at, and a target that spans the viewport is hard to miss.
 * - **`md` and up** — a small pill in the corner, an icon with a figure beside it when there is one
 *   worth reading. The page is the thing to look at, and the state is one glance away.
 *
 * The whole sentence is in the tooltip and in the accessible name at both sizes. Pressing it syncs
 * now: a retry that does not wait out the backoff, and a way to ask for fresh data without
 * reloading the page.
 */
export function SyncStatus() {
  const isOnline = useSyncStore((state) => state.isOnline);
  const status = useSyncStore((state) => state.status);
  const pending = useSyncStore((state) => state.pending);
  const syncedRows = useSyncStore((state) => state.syncedRows);
  const syncTotalRows = useSyncStore((state) => state.syncTotalRows);
  const outboxCount = useSyncStore((state) => state.outboxCount);
  const isPushing = useSyncStore((state) => state.isPushing);

  const view = describe({
    isOnline,
    status,
    pending,
    syncedRows,
    syncTotalRows,
    outboxCount,
    isPushing,
  });

  return (
    <div
      aria-live="polite"
      className="z-navbar fixed inset-x-0 top-0 md:inset-x-auto md:inset-s-0 md:p-3"
    >
      <button
        type="button"
        // Draining the outbox is the more urgent half, and it pulls once it is done anyway.
        onClick={() => void (outboxCount > 0 ? pushNow() : syncNow())}
        disabled={view.isBusy}
        aria-label={view.title}
        title={view.title}
        className={twJoin(
          "bg-surface border-border flex items-center gap-1.5 text-xs",
          // The strip: full width, one line tall, and only the edge it is not glued to is drawn.
          "w-full justify-center border-b px-3 py-1",
          // The pill: back to a shape the page can be seen around.
          "md:h-8 md:w-auto md:rounded-full md:border md:px-2.5 md:py-0 md:shadow",
          view.tone === "danger" ? "text-danger" : "text-text-muted",
          "hover:text-text disabled:hover:text-inherit",
        )}
      >
        {view.icon}
        <span className="md:hidden">{view.label}</span>
        {view.figure != null && <span className="hidden font-mono md:inline">{view.figure}</span>}
      </button>
    </div>
  );
}

type StatusInput = {
  isOnline: boolean;
  status: Status;
  pending: SyncedTable[];
  syncedRows: number;
  syncTotalRows: number | null;
  outboxCount: number;
  isPushing: boolean;
};

type StatusView = {
  icon: JSX.Element;
  /** What the strip says on a phone. Short enough to stay on one line at 320px. */
  label: string;
  /** Shown beside the icon in the pill, when there is a number the icon cannot convey on its own. */
  figure: string | null;
  /** The whole sentence, for the tooltip and for screen readers. */
  title: string;
  tone: "muted" | "danger";
  isBusy: boolean;
};

const ICON = "size-4 shrink-0";

/**
 * The four states the plan calls for, in the order they matter.
 *
 * Offline comes first because it explains every other state that would otherwise look like a fault,
 * and unsynced writes come before a running sync because they are the only part of this the user
 * could actually lose.
 */
function describe(state: StatusInput): StatusView {
  if (!state.isOnline) {
    return {
      icon: <CloudOffIcon className={ICON} />,
      // The icon already says "offline"; the words spend their width on what is at stake, which is
      // how much of the user's work is sitting on this device alone.
      label:
        state.outboxCount > 0
          ? `Offline — ${state.outboxCount.toLocaleString()} unsynced`
          : "Offline",
      figure: state.outboxCount > 0 ? state.outboxCount.toLocaleString() : null,
      title:
        state.outboxCount > 0
          ? `Offline — ${count(state.outboxCount)} saved on this device, waiting for a connection.`
          : "Offline — everything here is served from this device.",
      tone: "muted",
      isBusy: true,
    };
  }

  if (state.outboxCount > 0) {
    return {
      icon: state.isPushing ? (
        <RefreshCwIcon className={twJoin(ICON, "animate-spin")} />
      ) : (
        <CloudUploadIcon className={ICON} />
      ),
      label: state.isPushing
        ? `Saving ${state.outboxCount.toLocaleString()}…`
        : `${state.outboxCount.toLocaleString()} unsynced — tap to send`,
      figure: state.outboxCount.toLocaleString(),
      title: state.isPushing
        ? `Sending ${count(state.outboxCount)} to the server.`
        : `${count(state.outboxCount)} not on the server yet. Tap to send them now.`,
      tone: "muted",
      isBusy: state.isPushing,
    };
  }

  if (state.status === "syncing") {
    // Capped below 100 while a page is still outstanding: rows written during the run make the
    // count overshoot a backlog measured at its start, and "100%" still spinning reads as stuck.
    const percent =
      state.syncTotalRows != null &&
      state.syncTotalRows > 0 &&
      state.pending.includes("transactions")
        ? Math.min(99, Math.floor((state.syncedRows / state.syncTotalRows) * 100))
        : null;

    return {
      icon: <RefreshCwIcon className={twJoin(ICON, "animate-spin")} />,
      label: percent == null ? "Syncing…" : `Syncing transactions ${percent}%`,
      figure: percent == null ? null : `${percent}%`,
      title:
        percent == null
          ? "Checking for changes on the server."
          : `Still loading transactions — ${state.syncedRows.toLocaleString()} of ${state.syncTotalRows?.toLocaleString()}. Totals will keep moving until this finishes.`,
      tone: "muted",
      isBusy: true,
    };
  }

  if (state.status === "error") {
    return {
      icon: <CloudAlertIcon className={ICON} />,
      label: "Sync failed — tap to retry",
      figure: null,
      title: "Could not reach the server. Tap to try again.",
      tone: "danger",
      isBusy: false,
    };
  }

  return {
    icon: <CloudCheckIcon className={ICON} />,
    label: "Synced",
    figure: null,
    title: "Everything on this device is on the server. Tap to check for changes.",
    tone: "muted",
    isBusy: false,
  };
}

function count(changes: number): string {
  return `${changes.toLocaleString()} ${changes === 1 ? "change" : "changes"}`;
}
