// No top-level side effects: cache lives on globalThis, mirroring the
// getDb.server.ts singleton pattern, so a warm serverless invocation reuses it.
const globalForRates = globalThis as unknown as {
  usdRatesCache?: { date: string; rates: Record<string, number> };
};

/** Units of each currency per 1 USD, refetched once per UTC calendar day. */
export async function getUsdRates(): Promise<Record<string, number>> {
  const today = new Date().toISOString().slice(0, 10);
  if (globalForRates.usdRatesCache?.date === today) {
    return globalForRates.usdRatesCache.rates;
  }

  const res = await fetch("https://open.er-api.com/v6/latest/USD");
  if (!res.ok) throw new Error(`Failed to fetch currency rates: ${res.status}`);
  const { rates } = (await res.json()) as { rates: Record<string, number> };

  globalForRates.usdRatesCache = { date: today, rates };
  return rates;
}
