import { Card } from "~/components/Card";
import { Title } from "~/components/Title";
import { formatMoney } from "~/utils/formatMoney";
import type { getDailyAverages } from "~/api/statistics.functions";

type Props = {
  runway: Awaited<ReturnType<typeof getDailyAverages>>["runway"];
  perDayUsd: number;
};

/** How long the current balance lasts at the period's average burn, with no income. */
export function MoneyRunwayCard({ runway, perDayUsd }: Props) {
  return (
    <Card>
      <Title variant="card">Money runway</Title>
      <hr className="border-border my-3" />
      {runway.label == null ? (
        <>
          <p className="text-text-muted text-3xl font-bold">—</p>
          <p className="text-text-muted mt-1 text-sm">No spending in this period to burn it.</p>
        </>
      ) : (
        <>
          <p className="text-text text-3xl font-bold">{runway.label}</p>
          <p className="text-text-muted mt-1 text-sm">
            {formatMoney(String(runway.balanceUsd), "USD")} at{" "}
            {formatMoney(String(perDayUsd), "USD")} / day
          </p>
          <p className="text-text-muted text-xs">empty by {runway.emptyOnLabel}</p>
        </>
      )}
    </Card>
  );
}
