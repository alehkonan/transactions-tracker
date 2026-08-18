import { Card } from "~/components/Card";
import { Title } from "~/components/Title";
import { formatMoney } from "~/utils/format-money";
import type { CategorySpending } from "~/modules/statistics/compute-category-spending";

type Props = {
  /** The selected month's spending per category, already ranked — see `computeCategorySpending`. */
  spending: CategorySpending[];
};

/**
 * Where the selected month's spending went, ranked. A bar list rather than a pie: ranked lengths
 * read at a glance, and a pie with a slice per category needs a legend to mean anything.
 */
export function CategoryBreakdownCard({ spending }: Props) {
  return (
    <Card>
      <Title variant="card">Where the money went</Title>
      <hr className="border-border my-3" />
      {spending.length === 0 ? (
        <p className="text-text-muted text-sm">No spending this month.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {spending.map((entry) => (
            <li key={entry.categoryId ?? "none"}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: entry.colorHex ?? "var(--color-text-muted)" }}
                  />
                  <span className="truncate">{entry.name}</span>
                </span>
                <span className="flex shrink-0 items-baseline gap-2">
                  <span className="text-text-muted text-xs">
                    {entry.count} {entry.count === 1 ? "transaction" : "transactions"}
                  </span>
                  <span className="font-mono font-medium tabular-nums">
                    {formatMoney(String(entry.totalUsd), "USD")}
                  </span>
                </span>
              </div>
              <div className="bg-surface-muted mt-1.5 h-1.5 overflow-hidden rounded-full">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(entry.share * 100, 1)}%`,
                    backgroundColor: entry.colorHex ?? "var(--color-text-muted)",
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
