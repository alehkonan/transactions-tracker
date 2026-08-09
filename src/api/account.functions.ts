import { createServerFn } from "@tanstack/react-start";
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { accountStatusEnum, accountTypeEnum, currencyCodeEnum } from "~/database/enums";
import { getDb } from "~/database/getDb.server";
import { accountsTable, transactionsTable } from "~/database/tables";
import { authMiddleware } from "./auth.middleware";
import { getUsdRates } from "./currency-rates.server";
import { loggerMiddleware } from "./logger.middleware";
import { profileMiddleware } from "./profile.middleware";

export const getAccounts = createServerFn()
  .middleware([loggerMiddleware, authMiddleware, profileMiddleware])
  .handler(({ context }) => {
    if (context.profileId == null) return [];

    return getDb().query.accountsTable.findMany({
      where: eq(accountsTable.profileId, context.profileId),
      orderBy: asc(accountsTable.name),
    });
  });

/** Sums each account's balance by group (active current, active savings, archived), converted to USD. */
export const getBalanceTotals = createServerFn()
  .middleware([loggerMiddleware, authMiddleware, profileMiddleware])
  .handler(async ({ context }) => {
    if (context.profileId == null) {
      return { currentBalanceUsd: "0", savingsBalanceUsd: "0", archivedBalanceUsd: "0" };
    }

    const [accounts, rates] = await Promise.all([
      getDb().query.accountsTable.findMany({
        where: eq(accountsTable.profileId, context.profileId),
      }),
      getUsdRates(),
    ]);

    let currentBalanceUsd = 0;
    let savingsBalanceUsd = 0;
    let archivedBalanceUsd = 0;
    for (const account of accounts) {
      const usdAmount = Number(account.balance) / (rates[account.currencyCode] ?? 1);
      if (account.status === "ARCHIVED") archivedBalanceUsd += usdAmount;
      else if (account.type === "SAVING") savingsBalanceUsd += usdAmount;
      else currentBalanceUsd += usdAmount;
    }

    return {
      currentBalanceUsd: currentBalanceUsd.toFixed(2),
      savingsBalanceUsd: savingsBalanceUsd.toFixed(2),
      archivedBalanceUsd: archivedBalanceUsd.toFixed(2),
    };
  });

/** Sum of an account's transactions, as a correlated subquery usable in an `accounts` update. */
const transactionsSum = sql`coalesce((
  select sum(${transactionsTable.amount})
  from ${transactionsTable}
  where ${transactionsTable.accountId} = ${accountsTable.id}
), 0)`;

const createAccountSchema = z.object({
  name: z.string().trim().min(1),
  currencyCode: z.enum(currencyCodeEnum.enumValues),
  type: z.enum(accountTypeEnum.enumValues),
  status: z.enum(accountStatusEnum.enumValues),
  initialBalance: z.string().trim().optional(),
});

export const createAccount = createServerFn({ method: "POST" })
  .middleware([loggerMiddleware, authMiddleware, profileMiddleware])
  .validator(createAccountSchema)
  .handler(async ({ data, context }) => {
    if (context.profileId == null) return;

    // A brand-new account has no transactions yet, so its balance starts at the opening amount.
    await getDb()
      .insert(accountsTable)
      .values({ ...data, balance: data.initialBalance, profileId: context.profileId });
  });

const updateAccountSchema = z.object({
  id: z.number(),
  name: z.string().trim().min(1),
  currencyCode: z.enum(currencyCodeEnum.enumValues),
  type: z.enum(accountTypeEnum.enumValues),
  status: z.enum(accountStatusEnum.enumValues),
  initialBalance: z.string().trim().optional(),
});

export const updateAccount = createServerFn({ method: "POST" })
  .middleware([loggerMiddleware, authMiddleware])
  .validator(updateAccountSchema)
  .handler(async ({ data }) => {
    const { id, ...values } = data;
    await getDb()
      .update(accountsTable)
      // Editing the opening amount shifts the balance by the same amount, keeping the
      // account's transaction history intact.
      .set({
        ...values,
        ...(values.initialBalance != null && {
          balance: sql`${values.initialBalance}::numeric + ${transactionsSum}`,
        }),
      })
      .where(eq(accountsTable.id, id));
  });

/** Deletes an account; its transactions cascade-delete with it (see `transactionsTable.accountId`). */
export const deleteAccount = createServerFn({ method: "POST" })
  .middleware([loggerMiddleware, authMiddleware])
  .validator(z.number())
  .handler(async ({ data: id }) => {
    await getDb().delete(accountsTable).where(eq(accountsTable.id, id));
  });

/**
 * Recomputes every account's balance from its initial balance plus the sum of its transactions.
 * `balance` is normally kept in sync incrementally by the transaction mutations, so this is only
 * needed to fix drift (e.g. rows written before that logic existed, or a manual DB edit).
 */
export const reconcileAccountBalances = createServerFn({ method: "POST" })
  .middleware([loggerMiddleware, authMiddleware, profileMiddleware])
  .handler(async ({ context }) => {
    if (context.profileId == null) return;

    await getDb()
      .update(accountsTable)
      .set({ balance: sql`${accountsTable.initialBalance} + ${transactionsSum}` })
      .where(eq(accountsTable.profileId, context.profileId));
  });
