import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getAvailableSpendingMonths, getMonthlySpendingTrend } from "~/api/statistics.functions";
import { PageContainer } from "~/components/PageContainer";
import { Title } from "~/components/Title";
import { SpendingTrendCard } from "~/modules/statistics/SpendingTrendCard";

const currentYearMonth = () => {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
};

export const Route = createFileRoute("/statistics")({
  validateSearch: z.object({
    month: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .optional(),
  }),
  loaderDeps: ({ search }) => ({ month: search.month }),
  loader: async ({ deps }) => {
    const months = await getAvailableSpendingMonths();
    const month = deps.month ?? months[0]?.value ?? currentYearMonth();
    const trend = await getMonthlySpendingTrend({ data: { month } });
    return { months, month, trend };
  },
  component: () => {
    const { months, month, trend } = Route.useLoaderData();

    return (
      <PageContainer>
        <Title variant="page">Statistics</Title>
        <div className="py-4" />
        <SpendingTrendCard months={months} month={month} trend={trend} />
      </PageContainer>
    );
  },
});
