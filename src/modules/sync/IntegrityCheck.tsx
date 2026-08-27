import { CircleAlertIcon, CircleCheckIcon, LoaderCircleIcon } from "lucide-react";
import { useState } from "react";
import { twJoin } from "tailwind-merge";
import { Button } from "~/components/Button";
import { resyncFromScratch, verifyIntegrity } from "./sync-engine";
import type { IntegrityReport } from "./sync-engine";
import type { JSX } from "react";

/**
 * "Does this device still hold what the server holds", asked on demand.
 *
 * Everything in the app is read from a local copy, and a local copy that has quietly drifted looks
 * exactly like one that has not — the balances still add up, they are just adding up the wrong rows.
 * Nothing in the sync path would notice, so this is the one place that can, and it is deliberately
 * something the user asks for rather than a background check: it costs a round trip, and its only
 * answer is a full re-download.
 *
 * The comparison itself moves no rows (see `verifyIntegrity`) — four counts and four checksums.
 */
export function IntegrityCheck() {
  const [state, setState] = useState<CheckState>({ phase: "idle" });

  const check = async () => {
    setState({ phase: "checking" });
    try {
      setState({ phase: "checked", report: await verifyIntegrity() });
    } catch (error) {
      setState({ phase: "failed", message: toMessage(error) });
    }
  };

  const redownload = async () => {
    setState({ phase: "repairing" });
    try {
      const outcome = await resyncFromScratch();
      if (outcome.kind !== "completed") {
        if (outcome.kind === "blocked") {
          throw new Error("Send the waiting changes before re-downloading everything.");
        }
        if (outcome.kind === "didNotConverge") {
          throw new Error(`Sync did not converge after ${outcome.pages} pages.`);
        }
        throw outcome.error instanceof Error
          ? outcome.error
          : new Error("Could not re-download the data.");
      }
      // The gate is up by now — the working set was dropped — so this only matters if the pull was
      // quick enough that the page never went away.
      setState({ phase: "checked", report: { outcome: "matched" } });
    } catch (error) {
      setState({ phase: "failed", message: toMessage(error) });
    }
  };

  const view = describe(state);
  const isBusy = state.phase === "checking" || state.phase === "repairing";

  return (
    <div className="flex flex-col items-start gap-2">
      <p className="text-text-muted text-sm">
        Compares this device against the server without downloading anything.
      </p>
      <Button variant="secondary" onClick={() => void check()} disabled={isBusy}>
        {state.phase === "checking" ? "Checking…" : "Check this device"}
      </Button>
      {view && (
        <output
          className={twJoin(
            "flex items-center gap-1.5 text-sm",
            view.tone === "danger" ? "text-danger" : "text-text-muted",
          )}
        >
          {view.icon}
          {view.message}
        </output>
      )}
      {/* Only offered once something is actually wrong: it drops the local copy, which puts the app
          back behind the loading screen for as long as a first run takes. */}
      {state.phase === "checked" && state.report.outcome === "diverged" && (
        <Button variant="danger" onClick={() => void redownload()}>
          Re-download everything
        </Button>
      )}
    </div>
  );
}

type CheckState =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "checked"; report: IntegrityReport }
  | { phase: "repairing" }
  | { phase: "failed"; message: string };

type ResultView = {
  icon: JSX.Element;
  message: string;
  tone: "muted" | "danger";
};

const ICON = "size-4 shrink-0";

function describe(state: CheckState): ResultView | null {
  if (state.phase === "idle" || state.phase === "checking") return null;

  if (state.phase === "repairing") {
    return {
      icon: <LoaderCircleIcon className={twJoin(ICON, "animate-spin")} />,
      message: "Downloading everything again…",
      tone: "muted",
    };
  }

  if (state.phase === "failed") {
    return { icon: <CircleAlertIcon className={ICON} />, message: state.message, tone: "danger" };
  }

  if (state.report.outcome === "matched") {
    return {
      icon: <CircleCheckIcon className={ICON} />,
      message: "Everything on this device matches the server.",
      tone: "muted",
    };
  }

  if (state.report.outcome === "unsettled") {
    return {
      icon: <CircleAlertIcon className={ICON} />,
      // Not a fault: the two ends are supposed to differ while a change is on its way in either
      // direction, so there is nothing to compare yet.
      message: "Still syncing — try again once everything has settled.",
      tone: "muted",
    };
  }

  return {
    icon: <CircleAlertIcon className={ICON} />,
    message: `This device disagrees with the server about ${list(
      state.report.divergences.map((divergence) => divergence.table),
    )}.`,
    tone: "danger",
  };
}

/** "accounts", "accounts and transactions", "accounts, categories and transactions". */
function list(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Could not reach the server.";
}
