import { twJoin } from "tailwind-merge";
import { Card } from "~/components/Card";
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
 * Below `sm` it is one of three cards abreast rather than a full-width block, so it keeps the
 * headline number and drops the two lines under it — the chart is what that space is for.
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
  return (
    <Card>
      <Title variant="card" className="text-text-muted text-xs sm:hidden">
        {shortTitle}
      </Title>
      <Title variant="card" className="hidden sm:block">
        {title}
      </Title>
      <hr className="border-border my-1 sm:my-3" />
      <p
        className={twJoin(
          "text-xl font-bold sm:text-3xl",
          tone === "expense" ? "text-expense" : "text-income",
        )}
      >
        {formatMoney(String(perDayUsd), "USD")}
        <span className="text-text-muted hidden text-base font-normal sm:inline"> / day</span>
      </p>
      <p className="text-text-muted mt-1 hidden text-sm sm:block">
        {formatMoney(String(totalUsd), "USD")} over the last {days} days
      </p>
      <p className="text-text-muted hidden text-xs sm:block">{rangeLabel}</p>
    </Card>
  );
}
