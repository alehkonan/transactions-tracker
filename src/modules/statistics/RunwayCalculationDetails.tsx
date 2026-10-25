import { formatMoney } from "~/utils/format-money";
import type { DailyAverages } from "~/modules/statistics/compute-daily-averages";

type Props = {
  averages: DailyAverages;
};

export function RunwayCalculationDetails({ averages }: Props) {
  return (
    <div className="text-text-muted mt-2 text-sm">
      <p>
        Uses all {averages.days} calendar days. Unrecorded expenses can make the runway estimate too
        long.
      </p>
      <details className="mt-1">
        <summary className="text-text min-h-11 cursor-pointer content-center font-medium sm:min-h-9">
          How these estimates are calculated
        </summary>
        <div className="max-w-prose space-y-2 pb-2">
          <p>
            {averages.rangeLabel}: recorded Operating Spending of{" "}
            {formatMoney(String(averages.expense.totalUsd), "USD")} ÷ {averages.days} calendar days
            = {formatMoney(String(averages.expense.perDayUsd), "USD")} per day. Income uses the same
            dates and denominator. Today counts as a full day; days without records count as zero.
          </p>
          <p>
            Runway divides your combined account balances by average daily Operating Spending,
            assuming no future income. Archived balances are included, as is money assigned to Funds
            and Capital. Only actual Expense transactions allocated to Operating count as spending,
            including those from archived accounts. Transfers do not count, nor do reallocations,
            opening balances, or expenses from Funds or Capital. Refunds are Income and do not
            reduce spending. Correcting an original expense changes its historical period.
          </p>
          <p>
            All amounts are converted to USD using the latest exchange rates available on this
            device, not the rates on each transaction date. If a rate is unavailable, that currency
            is treated as 1:1 with USD. Displayed amounts are rounded; runway uses the unrounded
            spending average and rounds down to whole days.
          </p>
          <p>
            A longer history selection includes more calendar days, not necessarily more recorded
            expenses. Check that your records cover the selected period before relying on this
            estimate.
          </p>
        </div>
      </details>
    </div>
  );
}
