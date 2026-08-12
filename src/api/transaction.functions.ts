import { createServerFn } from "@tanstack/react-start";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { necessityLevelEnum, transactionTypeEnum } from "~/database/enums";
import { getDb } from "~/database/get-db.server";
import { accountsTable, transactionsTable } from "~/database/tables";
import { negateMoney, sumMoney } from "~/utils/money";
import { authMiddleware } from "./auth.middleware";
import { loggerMiddleware } from "./logger.middleware";
import { assertAccountsInProfile, assertCategoriesInProfile } from "./ownership.server";
import { profileMiddleware } from "./profile.middleware";

const transactionInputSchema = z.object({
  createdAt: z.string().optional(),
  categoryId: z.uuid().optional(),
  necessityLevel: z.enum(necessityLevelEnum.enumValues).optional(),
  type: z.enum(transactionTypeEnum.enumValues),
  accountId: z.uuid().optional(),
  amount: z.string(),
  comment: z.string().optional(),
});

// Postgres allows at most 65535 bind parameters per query; each row here uses up to 8.
export const INSERT_CHUNK_SIZE = 1000;

/** Groups signed amounts by the account they affect, dropping rows with no account. */
export function groupAmountsByAccount(
  rows: { accountId?: string | null; amount: string }[],
): Map<string, string[]> {
  const byAccount = new Map<string, string[]>();
  for (const { accountId, amount } of rows) {
    if (accountId == null) continue;
    byAccount.set(accountId, [...(byAccount.get(accountId) ?? []), amount]);
  }
  return byAccount;
}

/**
 * Soft-deletes transactions, so a delta pull can see the deletion instead of the rows silently
 * ceasing to exist (see `deleteAccount`).
 */
export const deleteTransactions = createServerFn({ method: "POST" })
  .middleware([loggerMiddleware, authMiddleware, profileMiddleware])
  .validator(z.array(z.uuid()))
  .handler(async ({ data: ids, context }) => {
    if (ids.length === 0 || context.profileId == null) return;

    // Ids come from the client, so both statements below are scoped to the caller's own
    // transactions. Reading through the same filter also keeps the balance deltas honest:
    // rows the caller cannot see cannot move anyone's balance either, and a row that is already
    // tombstoned must not reverse its amount a second time.
    const scope = and(
      inArray(transactionsTable.id, ids),
      eq(transactionsTable.profileId, context.profileId),
      isNull(transactionsTable.deletedAt),
    );

    const deletedAt = new Date();

    await getDb().transaction(async (tx) => {
      const removed = await tx
        .select({ accountId: transactionsTable.accountId, amount: transactionsTable.amount })
        .from(transactionsTable)
        .where(scope);

      await tx.update(transactionsTable).set({ deletedAt, updatedAt: deletedAt }).where(scope);

      // Deleting a transaction reverses its effect on the account's balance.
      const deltas = groupAmountsByAccount(
        removed.map((row) => ({ accountId: row.accountId, amount: negateMoney(row.amount) })),
      );
      for (const [accountId, amounts] of deltas) {
        await tx
          .update(accountsTable)
          .set({ balance: sql`${accountsTable.balance} + ${sumMoney(amounts)}` })
          .where(eq(accountsTable.id, accountId));
      }
    });
  });

export const createTransactions = createServerFn({ method: "POST" })
  .middleware([loggerMiddleware, authMiddleware, profileMiddleware])
  .validator(z.array(transactionInputSchema))
  .handler(async ({ data: inputs, context }) => {
    if (inputs.length === 0) return { count: 0 };
    if (context.profileId == null) return { count: 0 };

    const profileId = context.profileId;
    // Nothing may be filed against an account or category outside the caller's profile.
    await Promise.all([
      assertAccountsInProfile(
        profileId,
        inputs.map((input) => input.accountId),
      ),
      assertCategoriesInProfile(
        profileId,
        inputs.map((input) => input.categoryId),
      ),
    ]);

    const rows = inputs.map(({ createdAt, ...input }) => ({
      ...input,
      createdAt: createdAt ? new Date(createdAt) : undefined,
      // Denormalized from the account, which the assertion above just proved is this profile's.
      profileId,
    }));

    await getDb().transaction(async (tx) => {
      for (let i = 0; i < rows.length; i += INSERT_CHUNK_SIZE) {
        await tx.insert(transactionsTable).values(rows.slice(i, i + INSERT_CHUNK_SIZE));
      }

      const deltas = groupAmountsByAccount(inputs);
      for (const [accountId, amounts] of deltas) {
        await tx
          .update(accountsTable)
          .set({ balance: sql`${accountsTable.balance} + ${sumMoney(amounts)}` })
          .where(eq(accountsTable.id, accountId));
      }
    });

    return { count: inputs.length };
  });

export const updateTransaction = createServerFn({ method: "POST" })
  .middleware([loggerMiddleware, authMiddleware, profileMiddleware])
  .validator(z.object({ id: z.uuid(), ...transactionInputSchema.shape }))
  .handler(async ({ data: { id, createdAt, ...input }, context }) => {
    if (context.profileId == null) return;

    // Both the row being edited and the account/category it is being moved onto have to be the
    // caller's, or an edit could reach across profiles in either direction.
    const profileId = context.profileId;
    await Promise.all([
      assertAccountsInProfile(profileId, [input.accountId]),
      assertCategoriesInProfile(profileId, [input.categoryId]),
    ]);

    const scope = and(
      eq(transactionsTable.id, id),
      eq(transactionsTable.profileId, profileId),
      isNull(transactionsTable.deletedAt),
    );

    await getDb().transaction(async (tx) => {
      const [previous] = await tx
        .select({ accountId: transactionsTable.accountId, amount: transactionsTable.amount })
        .from(transactionsTable)
        .where(scope);

      // No visible row means it is not the caller's to edit — bail before touching any balance.
      if (!previous) return;

      await tx
        .update(transactionsTable)
        .set({
          ...input,
          createdAt: createdAt ? new Date(createdAt) : undefined,
          updatedAt: new Date(),
        })
        .where(scope);

      // Reverse the row's old effect and apply its new one; if the account didn't
      // change, these net out to a single delta on that account.
      const deltas = groupAmountsByAccount([
        { accountId: previous.accountId, amount: negateMoney(previous.amount) },
        { accountId: input.accountId, amount: input.amount },
      ]);
      for (const [accountId, amounts] of deltas) {
        await tx
          .update(accountsTable)
          .set({ balance: sql`${accountsTable.balance} + ${sumMoney(amounts)}` })
          .where(eq(accountsTable.id, accountId));
      }
    });
  });
