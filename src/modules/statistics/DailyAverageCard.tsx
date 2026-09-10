import { InfoIcon } from "lucide-react";
import { twJoin } from "tailwind-merge";
import { Card } from "~/components/Card";
import { Popover } from "~/components/Popover";
import { Title } from "~/components/Title";
import { formatMoney } from "~/utils/format-money";

type Props = {
  title: string;
  /** Compact label for the two-column mobile summary. */
  shortTitle: string;
  tone: "expense" | "income";
  perDayUsd: number;
  totalUsd: number;
  days: number;
  rangeLabel: string;
};

/**
 * One figure from `computeDailyAverages`, with the period it was measured over.
 *
 * Mobile keeps the figure visible and puts its calculation behind an explicitly labelled trigger.
 */
export function DailyAverageCard({
  title,
  shortTitle,
  tone,
  perDayUsd,
  totalUsd,
  days,
  rangeLabel,
}: Props) {
  const details = (
    <>
      <Title variant="card">{title}</Title>
      <hr className="border-border my-3" />
      <p
        className={twJoin(
          "font-mono text-2xl font-semibold wrap-anywhere tabular-nums",
          tone === "expense" ? "text-expense" : "text-gain",
        )}
      >
        {formatMoney(String(perDayUsd), "USD")}
        <span className="text-text-muted font-sans text-sm font-normal"> / day</span>
      </p>
      <p className="text-text-muted mt-1 text-sm">
        {formatMoney(String(totalUsd), "USD")} ÷ {days} calendar days
      </p>
      <p className="text-text-muted text-xs">{rangeLabel} · USD</p>
    </>
  );

  return (
    <>
      <div className="min-w-0 sm:hidden">
        <Popover
          aria-label={`${title} calculation`}
          renderTrigger={({ onOpen }) => (
            <button
              type="button"
              onClick={onOpen}
              aria-label={`${shortTitle}: ${formatMoney(String(perDayUsd), "USD")} USD. Show calculation`}
              className="border-border bg-surface hover:bg-surface-muted focus-visible:ring-accent w-full rounded-xl border p-2 text-left transition-[box-shadow,background-color,color,border-color] hover:shadow focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              <span className="text-text-muted flex items-center justify-between gap-1 text-sm">
                {shortTitle}
                <InfoIcon aria-hidden className="size-4 shrink-0" />
              </span>
              <hr className="border-border my-1" />
              <p
                className={twJoin(
                  "font-mono text-xl font-semibold wrap-anywhere tabular-nums",
                  tone === "expense" ? "text-expense" : "text-gain",
                )}
              >
                {formatMoney(String(perDayUsd), "USD")}
              </p>
            </button>
          )}
        >
          {details}
        </Popover>
      </div>
      <div className="hidden min-w-0 sm:block">
        <Card>{details}</Card>
      </div>
    </>
  );
}
