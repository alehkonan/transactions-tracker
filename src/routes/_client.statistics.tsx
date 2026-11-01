import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import {
  averagePeriodSchema,
  DEFAULT_AVERAGE_PERIOD,
} from "~/modules/statistics/compute-daily-averages";
import { StatisticsScreen } from "~/screens/StatisticsScreen";

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

    return (
      <StatisticsScreen
        period={search.period ?? DEFAULT_AVERAGE_PERIOD}
        month={search.month}
        onPeriodChange={(period) => navigate({ search: (prev) => ({ ...prev, period }) })}
        onMonthChange={(month) => navigate({ search: (prev) => ({ ...prev, month }) })}
      />
    );
  },
});
