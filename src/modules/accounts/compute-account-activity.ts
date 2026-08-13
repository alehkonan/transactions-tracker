import { startOfMonth } from "date-fns";
import { sumMoney } from "~/utils/money";
import type { SyncedTransaction } from "~/modules/sync/sync-types";

export type AccountActivity = {
  /** When money last moved on this account. */
  lastActivityAt: Date;
  /** Net movement this calendar month, in the account's own currency. */
  monthToDateAmount: string;
};

/**
 * What each account has been doing lately: when it last moved, and how much of it this month.
 *
 * A balance says what an account holds and nothing about whether it is in use — which is what the
 * space on an account card was being spent on before. Derived from the transactions already in the
 * store, like every other figure the app shows, and keyed by account id so an account that has
 * never been touched simply has no entry.
 */
export function computeAccountActivity(
  transactions: SyncedTransaction[],
  now = new Date(),
): Map<string, AccountActivity> {
  const monthStart = startOfMonth(now);
  const collected = new Map<string, { lastActivityAt: Date; monthAmounts: string[] }>();

  for (const transaction of transactions) {
    if (transaction.accountId == null) continue;

    const entry = collected.get(transaction.accountId);
    if (entry == null) {
      collected.set(transaction.accountId, {
        lastActivityAt: transaction.createdAt,
        monthAmounts: transaction.createdAt >= monthStart ? [transaction.amount] : [],
      });
      continue;
    }

    if (transaction.createdAt > entry.lastActivityAt) entry.lastActivityAt = transaction.createdAt;
    if (transaction.createdAt >= monthStart) entry.monthAmounts.push(transaction.amount);
  }

  return new Map(
    [...collected].map(([accountId, entry]) => [
      accountId,
      {
        lastActivityAt: entry.lastActivityAt,
        monthToDateAmount: sumMoney(entry.monthAmounts),
      },
    ]),
  );
}
