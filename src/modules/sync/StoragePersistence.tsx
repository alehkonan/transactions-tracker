import { LoaderCircleIcon, ShieldAlertIcon, ShieldCheckIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { twJoin } from "tailwind-merge";
import { Button } from "~/components/Button";

type PersistenceState =
  | "checking"
  | "available"
  | "requesting"
  | "persisted"
  | "denied"
  | "unsupported"
  | "failed";

/** Reports and, from a user gesture, requests protection for the browser's offline working set. */
export function StoragePersistence() {
  const [state, setState] = useState<PersistenceState>("checking");

  useEffect(() => {
    if (!navigator.storage?.persisted) {
      setState("unsupported");
      return;
    }

    void navigator.storage
      .persisted()
      .then((persisted) => setState(persisted ? "persisted" : "available"))
      .catch(() => setState("failed"));
  }, []);

  const requestPersistence = async () => {
    if (!navigator.storage?.persist) {
      setState("unsupported");
      return;
    }

    setState("requesting");
    try {
      setState((await navigator.storage.persist()) ? "persisted" : "denied");
    } catch {
      setState("failed");
    }
  };

  const isBusy = state === "checking" || state === "requesting";
  const isProtected = state === "persisted";
  const message = describe(state);

  return (
    <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="max-w-xl">
        <h3 className="text-text font-bold">Offline storage</h3>
        <p
          aria-live="polite"
          className={twJoin(
            "mt-1 flex items-start gap-1.5 text-sm",
            isProtected ? "text-text" : "text-text-muted",
          )}
        >
          {isBusy ? (
            <LoaderCircleIcon className="mt-0.5 size-4 shrink-0 animate-spin" aria-hidden="true" />
          ) : isProtected ? (
            <ShieldCheckIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          ) : (
            <ShieldAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          )}
          {message}
        </p>
      </div>

      {(state === "available" || state === "denied" || state === "failed") && (
        <Button variant="secondary" onClick={() => void requestPersistence()}>
          {state === "available" ? "Protect local data" : "Try protection again"}
        </Button>
      )}
    </div>
  );
}

function describe(state: PersistenceState): string {
  if (state === "checking") return "Checking whether this browser protects the local copy…";
  if (state === "requesting") return "Asking this browser to protect the local copy…";
  if (state === "persisted") return "Protected from automatic browser cleanup.";
  if (state === "available") {
    return "This browser may remove the local copy after a long period without use.";
  }
  if (state === "denied") {
    return "Protection was not granted. Synced data remains available from the server.";
  }
  if (state === "unsupported") {
    return "This browser does not offer storage protection. Synced data remains available from the server.";
  }
  return "Could not check storage protection. The local copy remains available for offline use.";
}
