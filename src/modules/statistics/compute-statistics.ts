import { format } from "date-fns";
import { toAccountsWithBalance } from "~/modules/accounts/compute-balances";
import { computeAvailableSpendingMonths } from "./compute-available-spending-months";
import { computeCategorySpending } from "./compute-category-spending";
import { computeDailyAverages } from "./compute-daily-averages";
import { computeMonthlySpendingTrend } from "./compute-monthly-spending-trend";
import type { AveragePeriod } from "./compute-daily-averages";
import type { CategoryRow } from "~/modules/categories/to-category-rows";
import type { SyncedRows, SyncedTable } from "~/modules/sync/sync-types";

type Options = Pick<SyncedRows, "accounts" | "transactions" | "spheres" | "allocations"> & {
  profileId: string | null;
  /** Category labels from the selected profile. */
  categories: CategoryRow[];
  usdRates: Record<string, number>;
  period: AveragePeriod;
  month?: string;
  isHydrated: boolean;
  pending: SyncedTable[];
};

/** One profile's reports, derived entirely from its local transactions and sphere attribution. */
export function computeStatistics(options: Options) {
  const { profileId, usdRates, period, categories } = options;
  const ownedAccounts = options.accounts.filter(
    (row) => profileId != null && row.profileId === profileId && row.deletedAt == null,
  );
  const transactions = options.transactions.filter(
    (row) => row.profileId === profileId && row.deletedAt == null,
  );
  // Holdings include every actual movement, even expenses excluded from Operating Spending.
  const accounts = toAccountsWithBalance(ownedAccounts, transactions);
  const accountById = new Map(accounts.map((row) => [row.id, row]));
  const spheres = new Map(
    options.spheres
      .filter((row) => row.profileId === profileId && row.deletedAt == null)
      .map((row) => [row.id, row]),
  );
  const allocations = new Map(
    options.allocations
      .filter(
        (row) => row.profileId === profileId && row.deletedAt == null && row.transactionId != null,
      )
      .map((row) => [row.transactionId, row]),
  );
  let historyComplete =
    profileId != null &&
    options.isHydrated &&
    !options.pending.some((table) =>
      ["profiles", "accounts", "transactions", "spheres", "allocations"].includes(table),
    );
  const reportingTransactions = transactions.filter((transaction) => {
    const account = accountById.get(transaction.accountId ?? "");
    if (!account) {
      historyComplete = false;
      return false;
    }
    if (transaction.type !== "EXPENSE") return true;
    const allocation = allocations.get(transaction.id);
    const sphere = allocation && spheres.get(allocation.sphereId);
    // Missing or stale companions must not silently lower the burn rate and inflate Runway.
    if (
      !allocation ||
      !sphere ||
      allocation.openingAccountId != null ||
      allocation.reallocationId != null ||
      Number(allocation.amount) !== Number(transaction.amount) ||
      allocation.currencyCode !== account.currencyCode ||
      allocation.createdAt.getTime() !== transaction.createdAt.getTime()
    ) {
      historyComplete = false;
      return false;
    }
    return sphere.type === "OPERATING";
  });
  const months = computeAvailableSpendingMonths(reportingTransactions);
  const month = options.month ?? months[0]?.value ?? format(new Date(), "yyyy-MM");
  return {
    months,
    month,
    averages: computeDailyAverages({
      transactions: reportingTransactions,
      accounts,
      usdRates,
      period,
      historyComplete,
    }),
    trend: computeMonthlySpendingTrend({
      transactions: reportingTransactions,
      accounts,
      usdRates,
      month,
    }),
    categorySpending: computeCategorySpending({
      transactions: reportingTransactions,
      accounts,
      categories,
      usdRates,
      month,
    }),
  };
}
