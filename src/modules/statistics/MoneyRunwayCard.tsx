import { Card } from "~/components/Card";
import { Title } from "~/components/Title";
import { formatMoney } from "~/utils/format-money";
import type { DailyAverages } from "~/modules/statistics/compute-daily-averages";

type Props = {
  runway: DailyAverages["runway"];
  perDayUsd: number;
};

/**
 * How long the current balance lasts at the period's average burn, with no income.
 *
 * Below `sm` it is one of three cards abreast: the units abbreviate and the two lines under the
 * headline go, so the spending chart is not pushed off a phone screen by three numbers.
 */
export function MoneyRunwayCard({ runway, perDayUsd }: Props) {
  return (
    <Card>
      <Title variant="card" className="text-text-muted text-xs sm:hidden">
        Runway
      </Title>
      <Title variant="card" className="hidden sm:block">
        Money runway
      </Title>
      <hr className="border-border my-1 sm:my-3" />
      {runway.label == null ? (
        <>
          <p className="text-text-muted text-xl font-bold sm:text-3xl">—</p>
          <p className="text-text-muted mt-1 hidden text-sm sm:block">
            No spending in this period to burn it.
          </p>
        </>
      ) : (
        <>
          <p className="text-text text-xl font-bold sm:text-3xl">
            <span className="sm:hidden">{runway.shortLabel}</span>
            <span className="hidden sm:inline">{runway.label}</span>
          </p>
          <p className="text-text-muted mt-1 hidden text-sm sm:block">
            {formatMoney(String(runway.balanceUsd), "USD")} at{" "}
            {formatMoney(String(perDayUsd), "USD")} / day
          </p>
          <p className="text-text-muted hidden text-xs sm:block">empty by {runway.emptyOnLabel}</p>
        </>
      )}
    </Card>
  );
}
