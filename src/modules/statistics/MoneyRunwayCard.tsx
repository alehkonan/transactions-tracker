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
        All remaining account money ÷ average daily Operating Spending, assuming no future income.
      </p>
      <p className="my-4 font-mono text-2xl font-semibold wrap-anywhere tabular-nums sm:text-3xl">
        {historyComplete ? (runway.label ?? "No estimate") : "No estimate"}
      </p>
      <p className="border-border text-text-muted border-t pt-3 text-sm">
        Available across all accounts:{" "}
        <span className="text-text font-mono font-medium wrap-anywhere tabular-nums">
          {formatMoney(String(runway.balanceUsd), "USD")}
        </span>
      </p>
      <p className="text-text-muted mt-1 text-sm">
        Includes archived accounts and money assigned to Funds and Capital.
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
