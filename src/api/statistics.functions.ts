import { createServerFn } from "@tanstack/react-start";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "~/database/getDb.server";
import { accountsTable, transactionsTable } from "~/database/tables";
import { authMiddleware } from "./auth.middleware";
import { getUsdRates } from "./currencyRates.server";
import { loggerMiddleware } from "./logger.middleware";

// TRANSFER rows move money between own accounts and don't count as spending or income.
const isSpending = eq(transactionsTable.type, "EXPENSE");

export const getAvailableSpendingMonths = createServerFn()
  .middleware([loggerMiddleware, authMiddleware])
  .handler(async () => {
    const monthExpr = sql<string>`date_trunc('month', ${transactionsTable.createdAt})`;
    const rows = await getDb()
      .selectDistinct({ month: monthExpr })
      .from(transactionsTable)
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

    const rows = await getDb()
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
          gte(transactionsTable.createdAt, monthStart),
          lt(transactionsTable.createdAt, monthEnd),
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
