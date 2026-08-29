// No top-level side effects: cache lives on globalThis, mirroring the
// getDb.server.ts singleton pattern, so a warm serverless invocation reuses it.
const CURRENCY_RATES_TIMEOUT_MS = 1_000;
const CURRENCY_RATES_FAILURE_BACKOFF_MS = 5 * 60 * 1_000;

const globalForRates = globalThis as unknown as {
  usdRatesCache?: { date: string; rates: Record<string, number> };
  usdRatesRetryAfter?: number;
};

/** Units of each currency per 1 USD, refetched once per UTC calendar day. */
export async function getUsdRates(): Promise<Record<string, number> | null> {
  const today = new Date().toISOString().slice(0, 10);
  if (globalForRates.usdRatesCache?.date === today) {
    return globalForRates.usdRatesCache.rates;
  }

  if ((globalForRates.usdRatesRetryAfter ?? 0) > Date.now()) return null;

  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", {
      signal: AbortSignal.timeout(CURRENCY_RATES_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Failed to fetch currency rates: ${res.status}`);
    const { rates } = (await res.json()) as { rates: Record<string, number> };

    globalForRates.usdRatesCache = { date: today, rates };
    globalForRates.usdRatesRetryAfter = undefined;
    return rates;
  } catch (error) {
    globalForRates.usdRatesRetryAfter = Date.now() + CURRENCY_RATES_FAILURE_BACKOFF_MS;
    throw error;
  }
}
