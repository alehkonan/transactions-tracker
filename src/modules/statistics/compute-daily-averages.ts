import {
  addDays,
  differenceInCalendarDays,
  format,
  formatDuration,
  intervalToDuration,
  isSameYear,
  startOfDay,
  startOfTomorrow,
  subDays,
  subMonths,
} from "date-fns";
import { z } from "zod";
import { toUsd } from "~/utils/money";
import type { Duration } from "date-fns";
import type { AccountWithBalance } from "~/modules/accounts/compute-balances";
import type { SyncedTransaction } from "~/modules/sync/sync-types";

export const averagePeriodSchema = z.enum(["3m", "6m", "1y"]);
export type AveragePeriod = z.infer<typeof averagePeriodSchema>;

export const DEFAULT_AVERAGE_PERIOD: AveragePeriod = "3m";

const periodMonths: Record<AveragePeriod, number> = { "3m": 3, "6m": 6, "1y": 12 };

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Renders a day count as "2 years 3 months" / "5 months 12 days" / "18 days" — always the two most
 * significant non-zero units, so long runways stay readable without drowning the headline in
 * trailing precision.
 */
function formatRunway(from: Date, days: number) {
  const duration = intervalToDuration({ start: from, end: addDays(from, days) });
  const units: (keyof Duration)[] = duration.years
    ? ["years", "months"]
    : duration.months
      ? ["months", "days"]
      : ["days"];
  return formatDuration(duration, { format: units, delimiter: " " }) || "0 days";
}

export type DailyAverages = {
  days: number;
  rangeLabel: string;
  expense: { totalUsd: number; perDayUsd: number };
  income: { totalUsd: number; perDayUsd: number };
  runway: {
    balanceUsd: number;
    days: number | null;
    label: string | null;
    emptyOnLabel: string | null;
  };
};

type Options = {
  transactions: SyncedTransaction[];
  /** Every account of the profile; only the ACTIVE ones count as money to spend. */
  accounts: AccountWithBalance[];
  usdRates: Record<string, number>;
  period: AveragePeriod;
};

/**
 * Average expense and income per day over the trailing `period` (ending with today, counted in
 * full), so both figures keep moving as the month fills in, plus how long the balance lasts at that
 * burn rate.
 */
export function computeDailyAverages({
  transactions,
  accounts,
  usdRates,
  period,
}: Options): DailyAverages {
  const now = new Date();
  // Exclusive upper bound at tomorrow's midnight, so today counts in full.
  const end = startOfTomorrow();
  const start = startOfDay(subMonths(now, periodMonths[period]));
  const days = differenceInCalendarDays(end, start);

  const currencyByAccount = new Map(accounts.map((account) => [account.id, account.currencyCode]));

  // EXPENSE rows are stored negative; both figures are reported as magnitudes.
  const totals = { EXPENSE: 0, INCOME: 0 };
  for (const transaction of transactions) {
    if (transaction.type === "TRANSFER") continue;
    if (transaction.createdAt < start || transaction.createdAt >= end) continue;

    const currencyCode =
      transaction.accountId != null ? currencyByAccount.get(transaction.accountId) : undefined;
    if (currencyCode == null) continue;

    totals[transaction.type] += Math.abs(toUsd(transaction.amount, currencyCode, usdRates));
  }

  const balanceUsd = accounts
    .filter((account) => account.status === "ACTIVE")
    .reduce((sum, account) => sum + toUsd(account.balance, account.currencyCode, usdRates), 0);

  // The year is only spelled out when the window straddles one, otherwise a 12-month range reads as
  // "Aug 11 – Aug 11".
  const last = subDays(end, 1);
  const dayFormat = isSameYear(start, last) ? "MMM d" : "MMM d, yyyy";
  const rangeLabel = `${format(start, dayFormat)} – ${format(last, dayFormat)}`;

  // How long the balance lasts at the period's average burn with no income at all. Undefined burn
  // (nothing spent) has no finite answer, so report null and let the card say so rather than
  // dividing by zero.
  const expensePerDay = totals.EXPENSE / days;
  const today = startOfDay(now);
  const runwayDays = expensePerDay > 0 ? Math.floor(Math.max(0, balanceUsd) / expensePerDay) : null;

  return {
    days,
    rangeLabel,
    expense: { totalUsd: round2(totals.EXPENSE), perDayUsd: round2(totals.EXPENSE / days) },
    income: { totalUsd: round2(totals.INCOME), perDayUsd: round2(totals.INCOME / days) },
    runway: {
      balanceUsd: round2(balanceUsd),
      days: runwayDays,
      label: runwayDays == null ? null : formatRunway(today, runwayDays),
      emptyOnLabel: runwayDays == null ? null : format(addDays(today, runwayDays), "MMM d, yyyy"),
    },
  };
}
