import { createServerFn } from "@tanstack/react-start";
import {
  addDays,
  differenceInCalendarDays,
  format,
  formatDuration,
  intervalToDuration,
  isSameYear,
  startOfDay,
  startOfTomorrow,
  subDays,
  subMonths,
} from "date-fns";
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "~/database/get-db.server";
import { accountsTable, transactionsTable } from "~/database/tables";
import { authMiddleware } from "./auth.middleware";
import { getUsdRates } from "./currency-rates.server";
import { loggerMiddleware } from "./logger.middleware";
import { profileMiddleware } from "./profile.middleware";
import type { Duration } from "date-fns";

// TRANSFER rows move money between own accounts and don't count as spending or income.
const isSpending = eq(transactionsTable.type, "EXPENSE");

export const getAvailableSpendingMonths = createServerFn()
  .middleware([loggerMiddleware, authMiddleware, profileMiddleware])
  .handler(async ({ context }) => {
    if (context.profileId == null) return [];

    const monthExpr = sql<string>`date_trunc('month', ${transactionsTable.createdAt})`;
    const rows = await getDb()
      .selectDistinct({ month: monthExpr })
      .from(transactionsTable)
      .where(and(isSpending, eq(transactionsTable.profileId, context.profileId)))
      .orderBy(sql`${monthExpr} desc`);

    return rows.map(({ month }) => {
      const date = new Date(month);
      return {
        value: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`,
        label: new Intl.DateTimeFormat(undefined, {
          month: "short",
          year: "numeric",
          timeZone: "UTC",
        }).format(date),
      };
    });
  });

const round2 = (value: number) => Math.round(value * 100) / 100;

export const averagePeriodSchema = z.enum(["3m", "6m", "1y"]);
export type AveragePeriod = z.infer<typeof averagePeriodSchema>;

export const DEFAULT_AVERAGE_PERIOD: AveragePeriod = "3m";

const periodMonths: Record<AveragePeriod, number> = { "3m": 3, "6m": 6, "1y": 12 };

/**
 * Renders a day count as "2 years 3 months" / "5 months 12 days" / "18 days" —
 * always the two most significant non-zero units, so long runways stay readable
 * without drowning the headline in trailing precision.
 */
function formatRunway(from: Date, days: number) {
  const duration = intervalToDuration({ start: from, end: addDays(from, days) });
  const units: (keyof Duration)[] = duration.years
    ? ["years", "months"]
    : duration.months
      ? ["months", "days"]
      : ["days"];
  return formatDuration(duration, { format: units, delimiter: " " }) || "0 days";
}

/**
 * Average expense and income per day over the trailing `period` (ending with
 * today, counted in full), so both figures keep moving as the month fills in.
 * Both come from one query pass since they share the window and the rate table.
 */
export const getDailyAverages = createServerFn()
  .middleware([loggerMiddleware, authMiddleware, profileMiddleware])
  .validator(z.object({ period: averagePeriodSchema }))
  .handler(async ({ data: { period }, context }) => {
    const now = new Date();
    // Exclusive upper bound at tomorrow's midnight, so today counts in full.
    const end = startOfTomorrow();
    const start = startOfDay(subMonths(now, periodMonths[period]));
    const days = differenceInCalendarDays(end, start);

    const rows =
      context.profileId == null
        ? []
        : await getDb()
            .select({
              type: transactionsTable.type,
              amount: transactionsTable.amount,
              currency: accountsTable.currencyCode,
            })
            .from(transactionsTable)
            .leftJoin(accountsTable, eq(transactionsTable.accountId, accountsTable.id))
            .where(
              and(
                inArray(transactionsTable.type, ["EXPENSE", "INCOME"]),
                eq(transactionsTable.profileId, context.profileId),
                gte(transactionsTable.createdAt, start),
                lt(transactionsTable.createdAt, end),
              ),
            );

    // Only ACTIVE accounts count as spendable money, matching `getProfiles`.
    const accounts =
      context.profileId == null
        ? []
        : await getDb()
            .select({ balance: accountsTable.balance, currency: accountsTable.currencyCode })
            .from(accountsTable)
            .where(
              and(
                eq(accountsTable.profileId, context.profileId),
                eq(accountsTable.status, "ACTIVE"),
              ),
            );

    const rates = await getUsdRates();
    // EXPENSE rows are stored negative; both figures are reported as magnitudes.
    const totals = { EXPENSE: 0, INCOME: 0 };
    for (const row of rows) {
      if (row.amount == null || row.currency == null) continue;
      totals[row.type as "EXPENSE" | "INCOME"] +=
        Math.abs(Number(row.amount)) / (rates[row.currency] ?? 1);
    }

    const balanceUsd = accounts.reduce(
      (sum, account) => sum + Number(account.balance) / (rates[account.currency] ?? 1),
      0,
    );

    // Formatted here rather than in the component: the label ships in the SSR
    // payload, so server and client can't disagree on locale and break hydration.
    // The year is only spelled out when the window straddles one, otherwise a
    // 12-month range reads as "Aug 11 – Aug 11".
    const last = subDays(end, 1);
    const dayFormat = isSameYear(start, last) ? "MMM d" : "MMM d, yyyy";
    const rangeLabel = `${format(start, dayFormat)} – ${format(last, dayFormat)}`;

    // How long the balance lasts at the period's average burn with no income at
    // all. Undefined burn (nothing spent) has no finite answer, so report null
    // and let the card say so rather than dividing by zero.
    const expensePerDay = totals.EXPENSE / days;
    const today = startOfDay(now);
    const runwayDays =
      expensePerDay > 0 ? Math.floor(Math.max(0, balanceUsd) / expensePerDay) : null;

    return {
      days,
      rangeLabel,
      expense: { totalUsd: round2(totals.EXPENSE), perDayUsd: round2(totals.EXPENSE / days) },
      income: { totalUsd: round2(totals.INCOME), perDayUsd: round2(totals.INCOME / days) },
      runway: {
        balanceUsd: round2(balanceUsd),
        days: runwayDays,
        label: runwayDays == null ? null : formatRunway(today, runwayDays),
        emptyOnLabel: runwayDays == null ? null : format(addDays(today, runwayDays), "MMM d, yyyy"),
      },
    };
  });

const monthInputSchema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) });

export const getMonthlySpendingTrend = createServerFn()
  .middleware([loggerMiddleware, authMiddleware, profileMiddleware])
  .validator(monthInputSchema)
  .handler(async ({ data: { month }, context }) => {
    const [year, monthNum] = month.split("-").map(Number);
    const monthStart = new Date(Date.UTC(year, monthNum - 1, 1));
    const monthEnd = new Date(Date.UTC(year, monthNum, 1));
    const daysInMonth = (monthEnd.getTime() - monthStart.getTime()) / (1000 * 60 * 60 * 24);

    const rows =
      context.profileId == null
        ? []
        : await getDb()
            .select({
              day: sql<number>`extract(day from ${transactionsTable.createdAt})`,
              amount: transactionsTable.amount,
              currency: accountsTable.currencyCode,
            })
            .from(transactionsTable)
            .leftJoin(accountsTable, eq(transactionsTable.accountId, accountsTable.id))
            .where(
              and(
                isSpending,
                eq(transactionsTable.profileId, context.profileId),
                gte(transactionsTable.createdAt, monthStart),
                lt(transactionsTable.createdAt, monthEnd),
              ),
            );

    const rates = await getUsdRates();
    // EXPENSE rows are stored negative; the chart plots spending as a rising
    // magnitude, and its Y axis starts at 0, so take the absolute value.
    const dailyUsd = Array.from({ length: daysInMonth }, () => 0);
    for (const row of rows) {
      if (row.amount == null || row.currency == null) continue;
      const rate = rates[row.currency] ?? 1;
      dailyUsd[row.day - 1] += Math.abs(Number(row.amount)) / rate;
    }

    let cumulative = 0;
    return dailyUsd.map((amount, index) => {
      cumulative += amount;
      return { day: index + 1, cumulativeUsd: Math.round(cumulative * 100) / 100 };
    });
  });
