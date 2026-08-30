import { Card } from "~/components/Card";
import { Popover } from "~/components/Popover";
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
 * Below `sm` it is one of three cards abreast: the compact figure opens a popover with the
 * complete desktop details, keeping the spending chart within reach.
 */
export function MoneyRunwayCard({ runway, perDayUsd }: Props) {
  const details = (
    <>
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
              aria-label="Show money runway details"
              className="border-border bg-surface hover:bg-surface-muted focus-visible:ring-accent w-full rounded-xl border p-2 text-left transition-[box-shadow,background-color,color,border-color] hover:shadow focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              <Title variant="card" className="text-text-muted text-xs">
                Runway
              </Title>
              <hr className="border-border my-1" />
              <p className="text-text text-xl font-bold">{runway.shortLabel ?? "—"}</p>
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
