/** Formats a numeric-string amount with its currency using the runtime's locale, e.g. `$12.50`. */
export function formatMoney(amount: string | null, currency: string | null): string {
  if (amount == null || currency == null) return "";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
    }).format(Number(amount));
  } catch {
    // `currency` isn't a well-formed ISO 4217 code (Intl.NumberFormat throws RangeError).
    return `${amount} ${currency}`;
  }
}
