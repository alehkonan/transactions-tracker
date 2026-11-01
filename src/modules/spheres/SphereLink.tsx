import { Link } from "@tanstack/react-router";
import { ChevronRightIcon } from "lucide-react";
import { useMoneyNavigation } from "~/modules/accounts/money-navigation";
import { useSyncStore } from "~/modules/sync/useSyncStore";
import { formatMoney } from "~/utils/format-money";
import { toUsd } from "~/utils/money";
import { sphereBalances } from "./sphere-lifecycle";
import type { SyncedSphere } from "~/modules/sync/sync-types";

export function SphereLink({
  sphere,
  complete,
  diverged = false,
}: {
  sphere: SyncedSphere;
  complete: boolean;
  diverged?: boolean;
}) {
  const { listState } = useMoneyNavigation();
  const allocations = useSyncStore((state) => state.allocations);
  const usdRates = useSyncStore((state) => state.usdRates);
  const balances = sphereBalances(sphere.profileId, sphere.id, allocations);
  const belowZero = balances.some((row) => Number(row.balance) < 0);
  const total = balances.reduce(
    (sum, row) => sum + toUsd(row.balance, row.currencyCode, usdRates),
    0,
  );
  return (
    <li data-testid={`sphere-${sphere.id}`}>
      <Link
        to="/accounts/purposes/$sphereId"
        params={{ sphereId: sphere.id }}
        state={listState}
        className="text-text hover:bg-surface-hover focus-visible:ring-accent grid min-h-16 w-full min-w-0 grid-cols-[minmax(0,1fr)_1rem] items-center gap-3 px-4 py-3 text-left focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
        data-testid="sphere-open"
      >
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1 basis-28">
            <span className="block font-medium wrap-anywhere">{sphere.name}</span>
            <span className="text-text-muted block text-xs">
              {sphere.type === "OPERATING"
                ? "Money you use every day."
                : sphere.type === "FUNDS"
                  ? "Funds"
                  : "Capital"}
            </span>
          </div>
          <span
            className={`ml-auto max-w-full text-right font-mono text-sm break-all tabular-nums ${complete && (belowZero || diverged) ? "text-warning" : "text-text"}`}
            data-testid="sphere-total"
          >
            <span className="sr-only">Approximate balance in USD: </span>
            {complete ? `≈ ${formatMoney(total.toFixed(2), "USD")}` : "Loading…"}
            {complete && belowZero && (
              <span className="block font-sans text-xs">Currency below zero</span>
            )}
            {complete && diverged && (
              <span className="block font-sans text-xs">Balances differ</span>
            )}
          </span>
        </div>
        <ChevronRightIcon aria-hidden="true" className="text-text-muted size-4 shrink-0" />
      </Link>
    </li>
  );
}
