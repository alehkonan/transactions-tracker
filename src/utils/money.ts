/**
 * Arithmetic on the decimal strings money is stored and moved around as.
 *
 * Amounts stay strings end to end — `numeric(14,2)` in postgres, a string in every payload — so the
 * only place a float appears is inside these helpers, over integer cents, where repeated addition
 * cannot drift.
 */

/** Sums decimal money strings via integer cents, so a long list of them stays exact. */
export function sumMoney(amounts: string[]): string {
  const totalCents = amounts.reduce((sum, amount) => sum + Math.round(Number(amount) * 100), 0);
  return (totalCents / 100).toFixed(2);
}

/** Flips an amount's sign, on the string, without a round trip through a float. */
export function negateMoney(amount: string): string {
  const trimmed = amount.trim();
  return trimmed.startsWith("-") ? trimmed.slice(1) : `-${trimmed}`;
}

/**
 * Converts an amount to USD at the given rates, which are quoted as units per 1 USD. An unknown
 * currency falls back to 1:1 rather than dropping the amount, so a total is never silently short.
 */
export function toUsd(
  amount: string,
  currencyCode: string | null | undefined,
  usdRates: Record<string, number>,
): number {
  const rate = (currencyCode != null ? usdRates[currencyCode] : undefined) ?? 1;
  return Number(amount) / rate;
}
