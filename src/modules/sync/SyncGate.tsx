import { useNavigate } from "@tanstack/react-router";
import { LoaderCircleIcon } from "lucide-react";
import { useEffect } from "react";
import { Button } from "~/components/Button";
import { Title } from "~/components/Title";
import { SyncProgress } from "./SyncProgress";
import { bootSync, syncNow, useSyncStore } from "./useSyncStore";
import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
};

/**
 * Holds the app back until there is enough data to render it with — which is the reference tables,
 * not the whole working set. Transactions arrive behind the app rather than in front of it, reported
 * by `SyncProgress` while they do.
 *
 * The server renders the shell and nothing else, so `isHydrated` is false on both sides of the first
 * paint — the loading screen below is what SSR emits, and the client picks up from exactly there
 * before swapping in the local copy. A returning visitor sees it for about as long as it takes to
 * read IndexedDB; a first run, for one page of the initial pull.
 */
export function SyncGate({ children }: Props) {
  const navigate = useNavigate();
  const isHydrated = useSyncStore((state) => state.isHydrated);
  const status = useSyncStore((state) => state.status);
  const error = useSyncStore((state) => state.error);

  useEffect(() => {
    void bootSync();
  }, []);

  // The route guards run off a forgeable hint cookie, so the server rejecting the pull is the first
  // real proof that the session is gone.
  useEffect(() => {
    if (status === "unauthorized") void navigate({ to: "/login", replace: true });
  }, [status, navigate]);

  if (isHydrated) {
    return (
      <>
        {children}
        <SyncProgress />
      </>
    );
  }

  if (status === "error") {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
        <Title variant="card">Could not load your data</Title>
        <p className="text-text-muted max-w-sm text-sm">{error}</p>
        <Button variant="primary" onClick={() => void syncNow()}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6">
      <LoaderCircleIcon className="text-text-muted size-8 animate-spin" aria-label="Loading" />
      <p className="text-text-muted text-sm">Loading your data…</p>
    </div>
  );
}
