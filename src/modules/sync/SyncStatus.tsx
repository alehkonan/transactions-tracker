import { useNavigate } from "@tanstack/react-router";
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

/** Keeps synchronization visible in the app header without covering navigation or forms. */
export function SyncStatus() {
  const navigate = useNavigate();
  const isOnline = useSyncStore((state) => state.isOnline);
  const status = useSyncStore((state) => state.status);
  const pending = useSyncStore((state) => state.pending);
  const syncedRows = useSyncStore((state) => state.syncedRows);
  const syncTotalRows = useSyncStore((state) => state.syncTotalRows);
  const outboxCount = useSyncStore((state) => state.outboxCount);
  const isPushing = useSyncStore((state) => state.isPushing);
  const syncAuth = useSyncStore((state) => state.syncAuth);

  const view = describe({
    isOnline,
    status,
    pending,
    syncedRows,
    syncTotalRows,
    outboxCount,
    isPushing,
    syncAuth,
  });

  return (
    <section
      id="sync-status-region"
      aria-label="Synchronization"
      tabIndex={-1}
      aria-live="polite"
      className="bg-surface border-border border-b pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]"
    >
      <button
        data-testid="sync-status"
        type="button"
        // Draining the outbox is the more urgent half, and it pulls once it is done anyway.
        onClick={() => {
          if (syncAuth === "login-required" || syncAuth === "owner-mismatch") {
            const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
            void navigate({ to: "/login", search: { returnTo } });
            return;
          }
          void (outboxCount > 0 ? pushNow() : syncNow());
        }}
        disabled={view.isBusy}
        aria-label={`${view.label}. ${view.title}`}
        title={view.title}
        className={twJoin(
          "max-w-page focus-visible:ring-accent mx-auto flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left text-sm focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset",
          view.tone === "danger" ? "text-danger" : "text-text-muted",
          "not-disabled:hover:bg-surface-hover transition-colors motion-reduce:transition-none",
        )}
      >
        <span aria-hidden="true">{view.icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block font-medium wrap-anywhere">{view.label}</span>
          {(outboxCount > 0 ||
            syncAuth === "login-required" ||
            syncAuth === "owner-mismatch" ||
            !isOnline ||
            status === "error" ||
            pending.includes("transactions")) && (
            <span className="mt-0.5 block text-xs wrap-anywhere">{view.title}</span>
          )}
        </span>
        {!view.isBusy && (
          <span className="shrink-0 text-xs underline">
            {syncAuth === "login-required" || syncAuth === "owner-mismatch"
              ? "Sign in"
              : outboxCount > 0
                ? "Send now"
                : status === "error"
                  ? "Retry"
                  : "Check now"}
          </span>
        )}
      </button>
    </section>
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
  syncAuth: "unknown" | "authenticated" | "login-required" | "owner-mismatch";
};

type StatusView = {
  icon: JSX.Element;
  /** Visible state label; wraps at narrow widths. */
  label: string;
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
  if (state.syncAuth === "login-required" || state.syncAuth === "owner-mismatch") {
    const changes =
      state.outboxCount > 0 ? ` ${count(state.outboxCount)} saved on this device.` : "";
    return {
      icon: <CloudAlertIcon className={ICON} />,
      label:
        state.syncAuth === "owner-mismatch"
          ? "Sign in as workspace owner"
          : state.isOnline
            ? "Sign in to sync"
            : "Offline — sign in to sync",
      title: `${state.syncAuth === "owner-mismatch" ? "The signed-in account does not own this local workspace." : state.isOnline ? "Your session needs sign-in before synchronization can resume." : "Connect and sign in to resume synchronization."} You can still view and edit local data.${changes}`,
      tone: "danger",
      isBusy: false,
    };
  }

  if (!state.isOnline) {
    return {
      icon: <CloudOffIcon className={ICON} />,
      // The icon already says "offline"; the words spend their width on what is at stake, which is
      // how much of the user's work is sitting on this device alone.
      label:
        state.outboxCount > 0
          ? `Offline — ${state.outboxCount.toLocaleString()} unsynced`
          : "Offline",
      title:
        state.outboxCount > 0
          ? `Offline — ${count(state.outboxCount)} saved on this device, waiting for a connection.`
          : "Offline — you can still view and edit local data.",
      tone: "muted",
      isBusy: true,
    };
  }

  if (state.outboxCount > 0) {
    return {
      icon: state.isPushing ? (
        <RefreshCwIcon className={twJoin(ICON, "animate-spin motion-reduce:animate-none")} />
      ) : (
        <CloudUploadIcon className={ICON} />
      ),
      label: state.isPushing
        ? `Saving ${state.outboxCount.toLocaleString()}…`
        : `${state.outboxCount.toLocaleString()} unsynced — tap to send`,
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
      icon: <RefreshCwIcon className={twJoin(ICON, "animate-spin motion-reduce:animate-none")} />,
      label: percent == null ? "Syncing…" : `Syncing transactions ${percent}%`,
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
      title: "Could not reach the server. Tap to try again.",
      tone: "danger",
      isBusy: false,
    };
  }

  if (state.syncAuth !== "authenticated") {
    return {
      icon: <CloudAlertIcon className={ICON} />,
      label: "Sync not started",
      title: "Synchronization has not completed yet.",
      tone: "muted",
      isBusy: false,
    };
  }

  return {
    icon: <CloudCheckIcon className={ICON} />,
    label: "Synced",
    title: "Everything on this device is on the server. Tap to check for changes.",
    tone: "muted",
    isBusy: false,
  };
}

function count(changes: number): string {
  return `${changes.toLocaleString()} ${changes === 1 ? "change" : "changes"}`;
}
