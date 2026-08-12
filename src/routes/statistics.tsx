import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { format } from "date-fns";
import { z } from "zod";
import {
  DEFAULT_AVERAGE_PERIOD,
  averagePeriodSchema,
  getAvailableSpendingMonths,
  getDailyAverages,
  getMonthlySpendingTrend,
} from "~/api/statistics.functions";
import { PageContainer } from "~/components/PageContainer";
import { Title } from "~/components/Title";
import { AveragePeriodToggle } from "~/modules/statistics/AveragePeriodToggle";
import { DailyAverageCard } from "~/modules/statistics/DailyAverageCard";
import { MoneyRunwayCard } from "~/modules/statistics/MoneyRunwayCard";
import { SpendingTrendCard } from "~/modules/statistics/SpendingTrendCard";

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
  loaderDeps: ({ search }) => ({ month: search.month, period: search.period }),
  loader: async ({ deps }) => {
    const period = deps.period ?? DEFAULT_AVERAGE_PERIOD;
    const [months, averages] = await Promise.all([
      getAvailableSpendingMonths(),
      getDailyAverages({ data: { period } }),
    ]);
    const month = deps.month ?? months[0]?.value ?? currentYearMonth();
    const trend = await getMonthlySpendingTrend({ data: { month } });
    return { months, month, trend, averages, period };
  },
  component: () => {
    const { months, month, trend, averages, period } = Route.useLoaderData();
    const navigate = useNavigate({ from: "/statistics" });

    return (
      <PageContainer>
        <Title variant="page">Statistics</Title>
        <div className="py-4" />
        <div className="flex items-center justify-between gap-4 pb-2">
          <Title variant="section">Averages</Title>
          <AveragePeriodToggle
            value={period}
            onValueChange={(next) => navigate({ search: (prev) => ({ ...prev, period: next }) })}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <DailyAverageCard
            title="Income per day"
            tone="income"
            perDayUsd={averages.income.perDayUsd}
            totalUsd={averages.income.totalUsd}
            days={averages.days}
            rangeLabel={averages.rangeLabel}
          />
          <DailyAverageCard
            title="Spending per day"
            tone="expense"
            perDayUsd={averages.expense.perDayUsd}
            totalUsd={averages.expense.totalUsd}
            days={averages.days}
            rangeLabel={averages.rangeLabel}
          />
          <MoneyRunwayCard runway={averages.runway} perDayUsd={averages.expense.perDayUsd} />
        </div>
        <div className="py-2" />
        <SpendingTrendCard months={months} month={month} trend={trend} />
      </PageContainer>
    );
  },
});
