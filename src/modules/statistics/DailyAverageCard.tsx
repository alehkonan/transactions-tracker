import { twJoin } from "tailwind-merge";
import { Card } from "~/components/Card";
import { Title } from "~/components/Title";
import { formatMoney } from "~/utils/format-money";

type Props = {
  title: string;
  tone: "expense" | "income";
  perDayUsd: number;
  totalUsd: number;
  days: number;
  rangeLabel: string;
};

/** A local daily average with its calculation visible on every screen size. */
export function DailyAverageCard({ title, tone, perDayUsd, totalUsd, days, rangeLabel }: Props) {
  return (
    <Card>
      <Title variant="card">{title}</Title>
      <p
        className={twJoin(
          "my-4 font-mono text-2xl font-semibold wrap-anywhere tabular-nums",
          tone === "expense" ? "text-expense" : "text-gain",
        )}
      >
        {formatMoney(String(perDayUsd), "USD")}
        <span className="text-text-muted font-sans text-sm font-normal"> / day</span>
      </p>
      <p className="border-border text-text-muted border-t pt-3 text-sm wrap-anywhere">
        <span className="font-mono tabular-nums">{formatMoney(String(totalUsd), "USD")}</span> ÷{" "}
        {days} calendar days
      </p>
      <p className="text-text-muted mt-1 text-xs">{rangeLabel} · USD</p>
    </Card>
  );
}
