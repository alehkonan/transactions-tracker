import { sumMoney, toUsd } from "~/utils/money";
import type { SyncedAccount, SyncedProfile, SyncedTransaction } from "~/modules/sync/sync-types";

/**
 * Balances, derived rather than replicated.
 *
 * `accounts.balance` is a server-side cache that two offline devices would fight over, so it never
 * arrives in a pull. Every figure the UI shows is computed here instead, from the account's opening
 * amount plus the transactions the client already holds — which makes it impossible for a balance to
 * disagree with the rows it is a sum of, and makes every mutation idempotent.
 */

export type AccountWithBalance = SyncedAccount & { balance: string };

/** `initialBalance` plus the sum of the account's transactions, for each account given. */
export function toAccountsWithBalance(
  accounts: SyncedAccount[],
  transactions: SyncedTransaction[],
): AccountWithBalance[] {
  const amountsByAccount = new Map<string, string[]>();
  for (const transaction of transactions) {
    if (transaction.accountId == null) continue;

    const amounts = amountsByAccount.get(transaction.accountId);
    if (amounts) amounts.push(transaction.amount);
    else amountsByAccount.set(transaction.accountId, [transaction.amount]);
  }

  return accounts.map((account) => ({
    ...account,
    balance: sumMoney([account.initialBalance, ...(amountsByAccount.get(account.id) ?? [])]),
  }));
}

export type BalanceTotals = {
  currentBalanceUsd: string;
  savingsBalanceUsd: string;
  archivedBalanceUsd: string;
};

/**
 * Totals by group (active current, active savings, archived), converted to USD since accounts can
 * each be in a different currency.
 */
export function computeBalanceTotals(
  accounts: AccountWithBalance[],
  usdRates: Record<string, number>,
): BalanceTotals {
  let currentBalanceUsd = 0;
  let savingsBalanceUsd = 0;
  let archivedBalanceUsd = 0;

  for (const account of accounts) {
    const usdAmount = toUsd(account.balance, account.currencyCode, usdRates);
    if (account.status === "ARCHIVED") archivedBalanceUsd += usdAmount;
    else if (account.type === "SAVING") savingsBalanceUsd += usdAmount;
    else currentBalanceUsd += usdAmount;
  }

  return {
    currentBalanceUsd: currentBalanceUsd.toFixed(2),
    savingsBalanceUsd: savingsBalanceUsd.toFixed(2),
    archivedBalanceUsd: archivedBalanceUsd.toFixed(2),
  };
}

export type ProfileSummary = {
  id: string;
  name: string;
  accountCount: number;
  transactionCount: number;
  currentBalanceUsd: string;
  savingsBalanceUsd: string;
};

/**
 * The profile picker's tiles: how much each profile holds and how much is in it. Only ACTIVE
 * accounts count towards the balances — an archived one is not money to spend.
 */
export function computeProfileSummaries(
  profiles: SyncedProfile[],
  accounts: SyncedAccount[],
  transactions: SyncedTransaction[],
  usdRates: Record<string, number>,
): ProfileSummary[] {
  const withBalance = toAccountsWithBalance(accounts, transactions);

  return profiles.map((profile) => {
    const ownAccounts = withBalance.filter((account) => account.profileId === profile.id);
    const totals = computeBalanceTotals(
      ownAccounts.filter((account) => account.status === "ACTIVE"),
      usdRates,
    );

    return {
      id: profile.id,
      name: profile.name,
      accountCount: ownAccounts.length,
      transactionCount: transactions.filter((transaction) => transaction.profileId === profile.id)
        .length,
      currentBalanceUsd: totals.currentBalanceUsd,
      savingsBalanceUsd: totals.savingsBalanceUsd,
    };
  });
}
