import { createServerFn } from "@tanstack/react-start";
import { eq, sql } from "drizzle-orm";
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

/** Deletes an account; its transactions cascade-delete with it (see `transactionsTable.accountId`). */
export const deleteAccount = createServerFn({ method: "POST" })
  .middleware([loggerMiddleware, authMiddleware])
  .validator(z.number())
  .handler(async ({ data: id }) => {
    await getDb().delete(accountsTable).where(eq(accountsTable.id, id));
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
