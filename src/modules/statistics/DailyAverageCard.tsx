import { twJoin } from "tailwind-merge";
import { Card } from "~/components/Card";
import { Popover } from "~/components/Popover";
import { Title } from "~/components/Title";
import { formatMoney } from "~/utils/format-money";

type Props = {
  title: string;
  /** Two words on a phone, where the card is a third of the screen wide: "Spending / day". */
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
 * Below `sm` it is one of three cards abreast rather than a full-width block, so it keeps a
 * compact headline and reveals the complete desktop details in a popover on tap.
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
        className={twJoin("text-3xl font-bold", tone === "expense" ? "text-expense" : "text-gain")}
      >
        {formatMoney(String(perDayUsd), "USD")}
        <span className="text-text-muted text-base font-normal"> / day</span>
      </p>
      <p className="text-text-muted mt-1 text-sm">
        {formatMoney(String(totalUsd), "USD")} over the last {days} days
      </p>
      <p className="text-text-muted text-xs">{rangeLabel}</p>
    </>
  );

  return (
    <>
      <div className="sm:hidden">
        <Popover
          renderTrigger={({ onOpen }) => (
            <button
              type="button"
              onClick={onOpen}
              aria-label={`Show ${title} details`}
              className="border-border bg-surface hover:bg-surface-muted focus-visible:ring-accent w-full rounded-xl border p-2 text-left transition-[box-shadow,background-color,color,border-color] hover:shadow focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              <Title variant="card" className="text-text-muted text-xs">
                {shortTitle}
              </Title>
              <hr className="border-border my-1" />
              <p
                className={twJoin(
                  "text-xl font-bold",
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
      <div className="hidden sm:block">
        <Card>{details}</Card>
      </div>
    </>
  );
}
