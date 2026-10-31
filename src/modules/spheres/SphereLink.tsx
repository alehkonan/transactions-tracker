import { Link } from "@tanstack/react-router";
import { ChevronRightIcon, TriangleAlertIcon } from "lucide-react";
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
        className="text-text hover:bg-surface-hover focus-visible:ring-accent grid min-h-16 grid-cols-[minmax(0,1fr)_auto_1rem] items-center gap-3 px-4 py-3 focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
        data-testid="sphere-open"
      >
        <span className="min-w-0 font-medium wrap-anywhere">{sphere.name}</span>
        <span
          className={`text-right font-mono text-sm tabular-nums ${belowZero || diverged ? "text-warning" : "text-text"}`}
          data-testid="sphere-total"
        >
          <span className="inline-flex items-center gap-1">
            {(belowZero || diverged) && (
              <TriangleAlertIcon aria-hidden="true" className="size-4 shrink-0" />
            )}
            <span>
              <span className="sr-only">Approximate balance in USD: </span>
              {complete ? `≈ ${formatMoney(total.toFixed(2), "USD")}` : "Loading…"}
            </span>
          </span>
          {belowZero && <span className="block font-sans text-xs">Currency below zero</span>}
          {diverged && <span className="block font-sans text-xs">Balances differ</span>}
        </span>
        <ChevronRightIcon aria-hidden="true" className="text-text-muted size-4" />
      </Link>
    </li>
  );
}
