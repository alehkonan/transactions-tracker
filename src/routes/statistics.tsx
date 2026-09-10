import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { format } from "date-fns";
import { useMemo } from "react";
import { z } from "zod";
import { PageContainer } from "~/components/PageContainer";
import { Select } from "~/components/Select";
import { Title } from "~/components/Title";
import { useAccounts } from "~/modules/accounts/useAccounts";
import { useCategories } from "~/modules/categories/useCategories";
import { readSelectedProfileId } from "~/modules/profile/profile-cookie";
import { AveragePeriodToggle } from "~/modules/statistics/AveragePeriodToggle";
import { CategoryBreakdownCard } from "~/modules/statistics/CategoryBreakdownCard";
import { computeAvailableSpendingMonths } from "~/modules/statistics/compute-available-spending-months";
import { computeCategorySpending } from "~/modules/statistics/compute-category-spending";
import {
  averagePeriodSchema,
  computeDailyAverages,
  DEFAULT_AVERAGE_PERIOD,
} from "~/modules/statistics/compute-daily-averages";
import { computeMonthlySpendingTrend } from "~/modules/statistics/compute-monthly-spending-trend";
import { DailyAverageCard } from "~/modules/statistics/DailyAverageCard";
import { MoneyRunwayCard } from "~/modules/statistics/MoneyRunwayCard";
import { RunwayCalculationDetails } from "~/modules/statistics/RunwayCalculationDetails";
import { SpendingTrendCard } from "~/modules/statistics/SpendingTrendCard";
import { useSyncStore } from "~/modules/sync/useSyncStore";

const currentYearMonth = () => format(new Date(), "yyyy-MM");

export const Route = createFileRoute("/statistics")({
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

    const profileId = readSelectedProfileId();
    const allTransactions = useSyncStore((state) => state.transactions);
    const usdRates = useSyncStore((state) => state.usdRates);
    const accounts = useAccounts();
    const categories = useCategories();

    const transactions = useMemo(
      () => allTransactions.filter((transaction) => transaction.profileId === profileId),
      [allTransactions, profileId],
    );

    // Three pure functions over the same in-memory array; what used to be 216 lines of SQL and
    // three round trips is now recomputed on every keystroke of a filter for free.
    const months = useMemo(() => computeAvailableSpendingMonths(transactions), [transactions]);
    const month = search.month ?? months[0]?.value ?? currentYearMonth();
    const averages = useMemo(
      () => computeDailyAverages({ transactions, accounts, usdRates, period }),
      [transactions, accounts, usdRates, period],
    );
    const trend = useMemo(
      () => computeMonthlySpendingTrend({ transactions, accounts, usdRates, month }),
      [transactions, accounts, usdRates, month],
    );
    // The breakdown and the trend share the same month selector, so paging one pages the other.
    const categorySpending = useMemo(
      () => computeCategorySpending({ transactions, accounts, categories, usdRates, month }),
      [transactions, accounts, categories, usdRates, month],
    );

    return (
      <PageContainer>
        <main className="flex flex-col gap-4">
          <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <Title variant="page">Statistics</Title>
            <p className="text-text-muted text-sm">All amounts in USD</p>
          </header>
          <section aria-label="Runway and daily averages">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
              <div>
                <p className="text-sm font-semibold">Spending history</p>
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
                <MoneyRunwayCard runway={averages.runway} perDayUsd={averages.expense.perDayUsd} />
              </div>
              <DailyAverageCard
                title="Spending per day"
                shortTitle="Spent / day"
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
          <section aria-label="Monthly spending">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <Title variant="section">Monthly spending</Title>
              {months.length > 0 && (
                <div>
                  <label htmlFor="statistics-month" className="sr-only">
                    Month for spending chart and categories
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
