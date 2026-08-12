import { twJoin } from "tailwind-merge";
import { Card } from "~/components/Card";
import { Title } from "~/components/Title";
import { formatMoney } from "~/utils/formatMoney";

type Props = {
  title: string;
  tone: "expense" | "income";
  perDayUsd: number;
  totalUsd: number;
  days: number;
  rangeLabel: string;
};

export function DailyAverageCard({ title, tone, perDayUsd, totalUsd, days, rangeLabel }: Props) {
  return (
    <Card>
      <Title variant="card">{title}</Title>
      <hr className="border-border my-3" />
      <p
        className={twJoin(
          "text-3xl font-bold",
          tone === "expense" ? "text-expense" : "text-income",
        )}
      >
        {formatMoney(String(perDayUsd), "USD")}
        <span className="text-text-muted text-base font-normal"> / day</span>
      </p>
      <p className="text-text-muted mt-1 text-sm">
        {formatMoney(String(totalUsd), "USD")} over the last {days} days
      </p>
      <p className="text-text-muted text-xs">{rangeLabel}</p>
    </Card>
  );
}
