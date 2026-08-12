import { createServerFn } from "@tanstack/react-start";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { accountStatusEnum, accountTypeEnum, currencyCodeEnum } from "~/database/enums";
import { getDb } from "~/database/get-db.server";
import { accountsTable, transactionsTable } from "~/database/tables";
import { authMiddleware } from "./auth.middleware";
import { loggerMiddleware } from "./logger.middleware";
import { profileMiddleware } from "./profile.middleware";

/**
 * Sum of an account's live transactions, as a correlated subquery usable in an `accounts` update.
 * Tombstoned rows are excluded: a soft-deleted transaction has stopped affecting any balance.
 */
const transactionsSum = sql`coalesce((
  select sum(${transactionsTable.amount})
  from ${transactionsTable}
  where ${transactionsTable.accountId} = ${accountsTable.id}
    and ${transactionsTable.deletedAt} is null
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
  id: z.uuid(),
  name: z.string().trim().min(1),
  currencyCode: z.enum(currencyCodeEnum.enumValues),
  type: z.enum(accountTypeEnum.enumValues),
  status: z.enum(accountStatusEnum.enumValues),
  initialBalance: z.string().trim().optional(),
});

export const updateAccount = createServerFn({ method: "POST" })
  .middleware([loggerMiddleware, authMiddleware, profileMiddleware])
  .validator(updateAccountSchema)
  .handler(async ({ data, context }) => {
    if (context.profileId == null) return;

    const { id, ...values } = data;
    await getDb()
      .update(accountsTable)
      // Editing the opening amount shifts the balance by the same amount, keeping the
      // account's transaction history intact.
      .set({
        ...values,
        updatedAt: new Date(),
        ...(values.initialBalance != null && {
          balance: sql`${values.initialBalance}::numeric + ${transactionsSum}`,
        }),
      })
      // Scoped by profile as well as id: the id alone comes from the client. A tombstoned row is
      // gone as far as every client is concerned, so it is not editable either.
      .where(
        and(
          eq(accountsTable.id, id),
          eq(accountsTable.profileId, context.profileId),
          isNull(accountsTable.deletedAt),
        ),
      );
  });

/**
 * Soft-deletes an account and, with it, its transactions.
 *
 * A tombstone rather than a `DELETE` because a delta pull can only see rows that still exist: a row
 * that vanishes outright stays on every client that already holds it, forever. `updatedAt` moves
 * with `deletedAt` so the deletion is what the next pull finds.
 *
 * The transactions have to be tombstoned explicitly. Their `onDelete: "cascade"` only fires for a
 * real delete, and without this the account would disappear from clients while the rows filed
 * against it stayed behind, counting towards balances belonging to nothing.
 */
export const deleteAccount = createServerFn({ method: "POST" })
  .middleware([loggerMiddleware, authMiddleware, profileMiddleware])
  .validator(z.uuid())
  .handler(async ({ data: id, context }) => {
    const { profileId } = context;
    if (profileId == null) return;

    const deletedAt = new Date();

    await getDb().transaction(async (tx) => {
      const [deleted] = await tx
        .update(accountsTable)
        .set({ deletedAt, updatedAt: deletedAt })
        .where(
          and(
            eq(accountsTable.id, id),
            eq(accountsTable.profileId, profileId),
            isNull(accountsTable.deletedAt),
          ),
        )
        .returning({ id: accountsTable.id });

      // Nothing matched: not this profile's account, or already deleted. Either way its
      // transactions are not this call's to touch.
      if (!deleted) return;

      await tx
        .update(transactionsTable)
        .set({ deletedAt, updatedAt: deletedAt })
        .where(and(eq(transactionsTable.accountId, id), isNull(transactionsTable.deletedAt)));
    });
  });

/**
 * Recomputes every account's balance from its initial balance plus the sum of its transactions.
 *
 * Server-side housekeeping only, now that clients derive balances from the transactions they hold
 * (see `compute-balances.ts`) — the column is kept for debugging and for whatever still reads the
 * database directly, and this is what fixes drift in it.
 *
 * Leaves `updatedAt` alone on purpose: `balance` is derived and never replicated, so restating it
 * is not a change a syncing client has to hear about.
 */
export const reconcileAccountBalances = createServerFn({ method: "POST" })
  .middleware([loggerMiddleware, authMiddleware, profileMiddleware])
  .handler(async ({ context }) => {
    if (context.profileId == null) return;

    await getDb()
      .update(accountsTable)
      .set({ balance: sql`${accountsTable.initialBalance} + ${transactionsSum}` })
      .where(and(eq(accountsTable.profileId, context.profileId), isNull(accountsTable.deletedAt)));
  });
