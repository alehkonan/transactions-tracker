import { createServerFn } from "@tanstack/react-start";
import { and, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "~/database/getDb.server";
import { accounts, transactions } from "~/database/schema";
import { authMiddleware } from "./auth.middleware";
import { getUsdRates } from "./currencyRates.server";
import { loggerMiddleware } from "./logger.middleware";

// "No amount" is stored as either NULL or a literal 0, depending on import source.
const hasOutcome = sql`${transactions.outcomeAmount} is not null and ${transactions.outcomeAmount}::numeric != 0`;
const hasNoIncome = or(
  isNull(transactions.incomeAmount),
  sql`${transactions.incomeAmount}::numeric = 0`,
);

// Spending = an outcome with no matching income. Both set = a transfer between own
// accounts; income only = income. Neither counts as spending.
const isSpending = and(hasOutcome, hasNoIncome);

export const getAvailableSpendingMonths = createServerFn()
  .middleware([loggerMiddleware, authMiddleware])
  .handler(async () => {
    const monthExpr = sql<string>`date_trunc('month', ${transactions.createdAt})`;
    const rows = await getDb()
      .selectDistinct({ month: monthExpr })
      .from(transactions)
      .where(isSpending)
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

const monthInputSchema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) });

export const getMonthlySpendingTrend = createServerFn()
  .middleware([loggerMiddleware, authMiddleware])
  .validator(monthInputSchema)
  .handler(async ({ data: { month } }) => {
    const [year, monthNum] = month.split("-").map(Number);
    const monthStart = new Date(Date.UTC(year, monthNum - 1, 1));
    const monthEnd = new Date(Date.UTC(year, monthNum, 1));
    const daysInMonth = (monthEnd.getTime() - monthStart.getTime()) / (1000 * 60 * 60 * 24);

    // Some imported rows have no per-transaction outcome_currency; fall back to the
    // outcome account's own currency in that case.
    const rows = await getDb()
      .select({
        day: sql<number>`extract(day from ${transactions.createdAt})`,
        amount: transactions.outcomeAmount,
        currency: sql<
          string | null
        >`coalesce(${transactions.outcomeCurrency}, ${accounts.currencyCode})`,
      })
      .from(transactions)
      .leftJoin(accounts, eq(transactions.outcomeAccountId, accounts.id))
      .where(
        and(
          isSpending,
          gte(transactions.createdAt, monthStart),
          lt(transactions.createdAt, monthEnd),
        ),
      );

    const rates = await getUsdRates();
    const dailyUsd = Array.from({ length: daysInMonth }, () => 0);
    for (const row of rows) {
      if (row.amount == null || row.currency == null) continue;
      const rate = rates[row.currency] ?? 1;
      dailyUsd[row.day - 1] += Number(row.amount) / rate;
    }

    let cumulative = 0;
    return dailyUsd.map((amount, index) => {
      cumulative += amount;
      return { day: index + 1, cumulativeUsd: Math.round(cumulative * 100) / 100 };
    });
  });
