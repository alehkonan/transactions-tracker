import { useNavigate } from "@tanstack/react-router";
import { LoaderCircleIcon } from "lucide-react";
import { useEffect } from "react";
import { Button } from "~/components/Button";
import { Title } from "~/components/Title";
import { PwaRecoveryLink } from "~/modules/pwa/PwaRecoveryLink";
import { LocalRecoveryPanel } from "./LocalRecoveryPanel";
import { bootSync, retryBootSync, startSyncTriggers } from "./sync-engine";
import { SyncConflictToasts } from "./SyncConflictToasts";
import { SyncStatus } from "./SyncStatus";
import { useSyncStore } from "./useSyncStore";
import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
};

/**
 * Holds the app back until there is enough data to render it with — which is the reference tables,
 * not the whole working set. Transactions arrive behind the app rather than in front of it, reported
 * by `SyncStatus` in the corner while they do.
 *
 * The anonymous SPA document contains no personalized UI. This client-only gate inspects IndexedDB
 * first, then opens a usable local replica without waiting for session validation or synchronization.
 */
export function SyncGate({ children }: Props) {
  const navigate = useNavigate();
  const isHydrated = useSyncStore((state) => state.isHydrated);
  const isLocalBooted = useSyncStore((state) => state.isLocalBooted);
  const selectedProfileId = useSyncStore((state) => state.selectedProfileId);
  const replicaContext = useSyncStore((state) => state.replicaContext);
  const recoveryRequired = useSyncStore((state) => state.recoveryRequired);
  const status = useSyncStore((state) => state.status);
  const error = useSyncStore((state) => state.error);
  const replicaId = useSyncStore((state) => state.replicaContext?.replicaId);

  useEffect(() => {
    void bootSync();
    // Registered alongside the boot rather than after it, so a tab that opens offline is already
    // listening for the `online` event that will let it finish.
    return startSyncTriggers();
  }, []);

  useEffect(() => {
    if (!isLocalBooted) return;
    const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;

    if (replicaContext?.ownerUserId == null && status !== "error") {
      void navigate({ to: "/login", search: { returnTo }, replace: true });
      return;
    }

    if (isHydrated && selectedProfileId == null && window.location.pathname !== "/profile") {
      void navigate({ to: "/profile", replace: true });
    }
  }, [isHydrated, isLocalBooted, navigate, replicaContext?.ownerUserId, selectedProfileId, status]);

  if (recoveryRequired) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <LocalRecoveryPanel />
      </div>
    );
  }

  if (isHydrated) {
    return (
      <>
        <div key={replicaId ?? "unbound"} className="contents">
          {children}
        </div>
        <SyncStatus />
        <SyncConflictToasts />
      </>
    );
  }

  if (isLocalBooted && replicaContext?.ownerUserId == null && status !== "error") {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <Title variant="card">Sign in to load your data</Title>
        <Button variant="primary" onClick={() => void navigate({ to: "/login" })}>
          Sign in
        </Button>
      </div>
    );
  }

  if (!isHydrated && status === "error") {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <Title variant="card">Could not load your data</Title>
        <p className="text-text-muted max-w-sm text-sm">{error}</p>
        <Button variant="primary" onClick={() => void retryBootSync()}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6">
      <LoaderCircleIcon className="text-text-muted size-8 animate-spin" aria-label="Loading" />
      <p className="text-text-muted text-sm">
        {isLocalBooted ? "Loading your data…" : "Opening local data…"}
      </p>
      <PwaRecoveryLink />
    </div>
  );
}
