import { createServerFn } from "@tanstack/react-start";
import { inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "~/database/getDb.server";
import { accountsTable, transactionsTable } from "~/database/tables";
import { authMiddleware } from "./auth.middleware";
import { loggerMiddleware } from "./logger.middleware";

export const getAccounts = createServerFn()
  .middleware([loggerMiddleware, authMiddleware])
  .handler(() => {
    return getDb().query.accountsTable.findMany();
  });

export const checkAccountNames = createServerFn({ method: "POST" })
  .middleware([loggerMiddleware, authMiddleware])
  .validator(z.record(z.string(), z.number().optional()))
  .handler(async ({ data: bindings }) => {
    const res = await getDb().query.accountsTable.findMany({
      where: inArray(accountsTable.name, Object.keys(bindings)),
      columns: { id: true, name: true },
    });

    return {
      ...bindings,
      ...Object.fromEntries(res.map(({ id, name }) => [name, id])),
    };
  });

export const createAccountNames = createServerFn({ method: "POST" })
  .middleware([loggerMiddleware, authMiddleware])
  .validator(z.array(z.string()))
  .handler(async ({ data: names }) => {
    return getDb()
      .insert(accountsTable)
      .values([...new Set(names)].map((name) => ({ name })))
      .returning({ id: accountsTable.id, name: accountsTable.name });
  });

/**
 * Recomputes every account's balance from the sum of its transactions. `balance` is normally
 * kept in sync incrementally by the transaction mutations, so this is only needed to fix drift
 * (e.g. rows written before that logic existed, or a manual DB edit).
 */
export const reconcileAccountBalances = createServerFn({ method: "POST" })
  .middleware([loggerMiddleware, authMiddleware])
  .handler(async () => {
    await getDb()
      .update(accountsTable)
      .set({
        balance: sql`coalesce((
          select sum(${transactionsTable.amount})
          from ${transactionsTable}
          where ${transactionsTable.accountId} = ${accountsTable.id}
        ), 0)`,
      });
  });
