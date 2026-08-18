import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { format } from "date-fns";
import { useMemo } from "react";
import { z } from "zod";
import { PageContainer } from "~/components/PageContainer";
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
        <Title variant="page">Statistics</Title>
        {/* The chart is the reason this page exists and it used to start below the fold on a
            phone, under a screen and a half of stacked cards. Three abreast is what buys it back —
            rather than reordering, which would have left the reading order disagreeing with the
            visual one at one size or the other. */}
        <div className="mt-4 flex flex-col gap-4">
          <section>
            <div className="flex items-center justify-between gap-4 pb-2">
              <Title variant="section">Averages</Title>
              <AveragePeriodToggle
                value={period}
                onValueChange={(next) =>
                  navigate({ search: (prev) => ({ ...prev, period: next }) })
                }
              />
            </div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
              <DailyAverageCard
                title="Income per day"
                shortTitle="Income / day"
                tone="income"
                perDayUsd={averages.income.perDayUsd}
                totalUsd={averages.income.totalUsd}
                days={averages.days}
                rangeLabel={averages.rangeLabel}
              />
              <DailyAverageCard
                title="Spending per day"
                shortTitle="Spent / day"
                tone="expense"
                perDayUsd={averages.expense.perDayUsd}
                totalUsd={averages.expense.totalUsd}
                days={averages.days}
                rangeLabel={averages.rangeLabel}
              />
              <MoneyRunwayCard runway={averages.runway} perDayUsd={averages.expense.perDayUsd} />
            </div>
          </section>
          <section>
            <SpendingTrendCard months={months} month={month} trend={trend} />
          </section>
          <section>
            <CategoryBreakdownCard spending={categorySpending} />
          </section>
        </div>
      </PageContainer>
    );
  },
});
