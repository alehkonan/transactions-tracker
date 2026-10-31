import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { z } from "zod";
import { PageContainer } from "~/components/PageContainer";
import { Select } from "~/components/Select";
import { Title } from "~/components/Title";
import { useCategories } from "~/modules/categories/useCategories";
import { useSelectedProfileId } from "~/modules/profile/local-selection";
import { AveragePeriodToggle } from "~/modules/statistics/AveragePeriodToggle";
import { CategoryBreakdownCard } from "~/modules/statistics/CategoryBreakdownCard";
import {
  averagePeriodSchema,
  DEFAULT_AVERAGE_PERIOD,
} from "~/modules/statistics/compute-daily-averages";
import { computeStatistics } from "~/modules/statistics/compute-statistics";
import { DailyAverageCard } from "~/modules/statistics/DailyAverageCard";
import { MoneyRunwayCard } from "~/modules/statistics/MoneyRunwayCard";
import { RunwayCalculationDetails } from "~/modules/statistics/RunwayCalculationDetails";
import { SpendingTrendCard } from "~/modules/statistics/SpendingTrendCard";
import { useSyncStore } from "~/modules/sync/useSyncStore";

export const Route = createFileRoute("/_client/statistics")({
  validateSearch: z.object({
    month: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .optional(),
    // Left optional so the default period stays out of the URL, matching `month`;
    // `catch` keeps a hand-edited value from throwing the page to the error boundary.
    period: averagePeriodSchema.optional().catch(DEFAULT_AVERAGE_PERIOD),
  }),
  component: () => {
    const search = Route.useSearch();
    const navigate = useNavigate({ from: "/statistics" });
    const period = search.period ?? DEFAULT_AVERAGE_PERIOD;

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
          month: search.month,
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
        search.month,
        isHydrated,
        pending,
      ],
    );

    return (
      <PageContainer>
        <main aria-labelledby="statistics-heading" className="flex flex-col gap-4">
          <header className="flex flex-wrap items-baseline justify-between gap-2">
            <h1 id="statistics-heading" className="text-2xl font-bold tracking-tight">
              Statistics
            </h1>
            <p className="text-text-muted text-sm">Approximate totals in USD</p>
          </header>
          <section aria-label="Runway and daily averages">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
              <div>
                <p className="text-sm font-semibold">Operating Spending history</p>
                <p className="text-text-muted text-xs">{averages.rangeLabel}</p>
              </div>
              <AveragePeriodToggle
                value={period}
                onValueChange={(next) =>
                  navigate({ search: (prev) => ({ ...prev, period: next }) })
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-4">
              <div className="col-span-2 min-w-0">
                <MoneyRunwayCard
                  runway={averages.runway}
                  perDayUsd={averages.expense.perDayUsd}
                  historyComplete={averages.historyComplete}
                />
              </div>
              <DailyAverageCard
                title="Operating Spending per day"
                shortTitle="Operating / day"
                tone="expense"
                perDayUsd={averages.expense.perDayUsd}
                totalUsd={averages.expense.totalUsd}
                days={averages.days}
                rangeLabel={averages.rangeLabel}
              />
              <DailyAverageCard
                title="Income per day"
                shortTitle="Income / day"
                tone="income"
                perDayUsd={averages.income.perDayUsd}
                totalUsd={averages.income.totalUsd}
                days={averages.days}
                rangeLabel={averages.rangeLabel}
              />
            </div>
            <RunwayCalculationDetails averages={averages} />
          </section>
          <hr className="border-border" />
          <section aria-label="Monthly Operating Spending">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
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
                    onValueChange={(value) =>
                      value && navigate({ search: (prev) => ({ ...prev, month: value }) })
                    }
                  />
                </div>
              )}
            </div>
            <div className="flex flex-col gap-4">
              <SpendingTrendCard hasSpendingData={months.length > 0} month={month} trend={trend} />
              <CategoryBreakdownCard spending={categorySpending} />
            </div>
          </section>
        </main>
      </PageContainer>
    );
  },
});
