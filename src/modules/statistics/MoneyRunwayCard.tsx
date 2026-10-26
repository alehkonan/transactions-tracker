import { Card } from "~/components/Card";
import { Title } from "~/components/Title";
import { formatMoney } from "~/utils/format-money";
import type { DailyAverages } from "~/modules/statistics/compute-daily-averages";

type Props = {
  runway: DailyAverages["runway"];
  perDayUsd: number;
  historyComplete: boolean;
};

export function MoneyRunwayCard({ runway, perDayUsd, historyComplete }: Props) {
  return (
    <Card>
      <Title variant="card">Estimated runway</Title>
      <p className="text-text-muted text-sm">
        If income stopped and Operating Spending stayed at this rate.
      </p>
      <p className="mt-2 text-2xl font-semibold sm:text-3xl">
        {historyComplete ? (runway.label ?? "No estimate") : "No estimate"}
      </p>
      <p className="text-text-muted mt-1 text-sm">
        Approximate total account balance (including archived):{" "}
        <span className="text-text font-mono font-medium tabular-nums">
          {formatMoney(String(runway.balanceUsd), "USD")}
        </span>
      </p>
      {!historyComplete ? (
        <output className="text-text-muted mt-1 block text-sm">
          History is incomplete. Finish loading transactions and sphere attribution before using
          this estimate.
        </output>
      ) : runway.label == null ? (
        <p className="text-text-muted mt-1 text-sm">
          No recorded Operating Spending in this period. Add expenses or select a longer history.
        </p>
      ) : runway.days === 0 ? (
        <p className="text-text-muted mt-1 text-sm">
          {runway.balanceUsd <= 0
            ? "No positive available balance at this spending rate."
            : "Less than one day at this spending rate."}
        </p>
      ) : (
        <p className="text-text-muted mt-1 text-sm">
          At <span className="font-mono tabular-nums">{formatMoney(String(perDayUsd), "USD")}</span>{" "}
          / day · could last until {runway.emptyOnLabel}.
        </p>
      )}
    </Card>
  );
}
