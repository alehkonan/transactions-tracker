import { useMemo } from "react";
import { PageContainer } from "~/components/PageContainer";
import { Select } from "~/components/Select";
import { Title } from "~/components/Title";
import { useCategories } from "~/modules/categories/useCategories";
import { useSelectedProfileId } from "~/modules/profile/local-selection";
import { AveragePeriodToggle } from "~/modules/statistics/AveragePeriodToggle";
import { CategoryBreakdownCard } from "~/modules/statistics/CategoryBreakdownCard";
import { computeStatistics } from "~/modules/statistics/compute-statistics";
import { DailyAverageCard } from "~/modules/statistics/DailyAverageCard";
import { MoneyRunwayCard } from "~/modules/statistics/MoneyRunwayCard";
import { RunwayCalculationDetails } from "~/modules/statistics/RunwayCalculationDetails";
import { SpendingTrendCard } from "~/modules/statistics/SpendingTrendCard";
import { useSyncStore } from "~/modules/sync/useSyncStore";
import type { AveragePeriod } from "~/modules/statistics/compute-daily-averages";

type Props = {
  period: AveragePeriod;
  month?: string;
  onPeriodChange: (period: AveragePeriod) => void;
  onMonthChange: (month: string) => void;
};

export function StatisticsScreen({
  period,
  month: selectedMonth,
  onPeriodChange,
  onMonthChange,
}: Props) {
  const profileId = useSelectedProfileId();
  const allTransactions = useSyncStore((state) => state.transactions);
  const allAccounts = useSyncStore((state) => state.accounts);
  const allocations = useSyncStore((state) => state.allocations);
  const spheres = useSyncStore((state) => state.spheres);
  const isHydrated = useSyncStore((state) => state.isHydrated);
  const pending = useSyncStore((state) => state.pending);
  const usdRates = useSyncStore((state) => state.usdRates);
  const categories = useCategories();

  const { months, month, averages, trend, categorySpending } = useMemo(
    () =>
      computeStatistics({
        profileId,
        transactions: allTransactions,
        accounts: allAccounts,
        allocations,
        spheres,
        categories,
        usdRates,
        period,
        month: selectedMonth,
        isHydrated,
        pending,
      }),
    [
      profileId,
      allTransactions,
      allAccounts,
      allocations,
      spheres,
      categories,
      usdRates,
      period,
      selectedMonth,
      isHydrated,
      pending,
    ],
  );

  return (
    <PageContainer>
      <main aria-labelledby="statistics-heading" className="min-w-0 space-y-6 py-2 md:py-6">
        <header className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 id="statistics-heading" className="text-2xl font-bold tracking-tight">
            Statistics
          </h1>
          <p className="text-text-muted text-sm">Approximate totals in USD</p>
        </header>
        <section aria-label="Runway and daily averages">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">Operating Spending history</p>
              <p className="text-text-muted text-xs">{averages.rangeLabel}</p>
            </div>
            <AveragePeriodToggle value={period} onValueChange={onPeriodChange} />
          </div>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] lg:gap-4 [&_article]:h-full [&>article]:min-w-0">
            <div className="min-w-0 sm:col-span-2 lg:col-span-1">
              <MoneyRunwayCard
                runway={averages.runway}
                perDayUsd={averages.expense.perDayUsd}
                historyComplete={averages.historyComplete}
              />
            </div>
            <DailyAverageCard
              title="Operating Spending per day"
              tone="expense"
              perDayUsd={averages.expense.perDayUsd}
              totalUsd={averages.expense.totalUsd}
              days={averages.days}
              rangeLabel={averages.rangeLabel}
            />
            <DailyAverageCard
              title="Income per day"
              tone="income"
              perDayUsd={averages.income.perDayUsd}
              totalUsd={averages.income.totalUsd}
              days={averages.days}
              rangeLabel={averages.rangeLabel}
            />
          </div>
          <RunwayCalculationDetails averages={averages} />
        </section>
        <section aria-label="Monthly Operating Spending">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <Title variant="section">Monthly Operating Spending</Title>
            {months.length > 0 && (
              <div>
                <label htmlFor="statistics-month" className="sr-only">
                  Month for Operating Spending chart and categories
                </label>
                <Select
                  id="statistics-month"
                  options={months}
                  value={month}
                  className="rounded-lg"
                  onValueChange={(value) => value && onMonthChange(value)}
                />
              </div>
            )}
          </div>
          <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] [&>article]:min-w-0">
            <SpendingTrendCard hasSpendingData={months.length > 0} month={month} trend={trend} />
            <CategoryBreakdownCard spending={categorySpending} />
          </div>
        </section>
      </main>
    </PageContainer>
  );
}
