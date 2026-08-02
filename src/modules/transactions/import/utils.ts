import { currencyCodeEnum, necessityLevelEnum } from "~/database/schema";
import type { Bindings, ColumnMapping } from "./useTransactionsImport";
import type { ParsedCsv } from "~/utils/parseCsv";

export function getUniqueColumnValues(csv: ParsedCsv, selectedHeaders: string[]) {
  const indices = selectedHeaders
    .map((header) => csv.headers.indexOf(header))
    .filter((index) => index !== -1);

  const values = new Set<string>();
  for (const row of csv.rows) {
    for (const index of indices) {
      const value = row[index];
      if (value) values.add(value);
    }
  }
  return [...values];
}

/** Reads the value of `row` for whichever CSV header is mapped to `column`. */
export function getMappedValue(csv: ParsedCsv, row: string[], header: string | undefined) {
  if (!header) return undefined;
  const index = csv.headers.indexOf(header);
  return index === -1 ? undefined : row[index] || undefined;
}

type NecessityLevel = (typeof necessityLevelEnum.enumValues)[number];
type CurrencyCode = (typeof currencyCodeEnum.enumValues)[number];

/** Narrows a raw CSV value to one of `values`, or `undefined` if it doesn't match any of them. */
function toEnumValue<T extends string>(
  values: readonly T[],
  value: string | undefined,
): T | undefined {
  return value !== undefined && (values as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

export type TransactionInput = {
  createdAt?: string;
  categoryId?: number;
  necessityLevel?: NecessityLevel;
  incomeAccountId?: number;
  incomeAmount?: string;
  incomeCurrency?: CurrencyCode;
  outcomeAccountId?: number;
  outcomeAmount?: string;
  outcomeCurrency?: CurrencyCode;
};

/** Builds one `transactions` insert row per CSV row, resolving account/category names to ids via the given bindings. */
export function buildTransactionInputs(
  csv: ParsedCsv,
  columnMapping: ColumnMapping,
  accountBindings: Bindings,
  categoryBindings: Bindings,
): TransactionInput[] {
  return csv.rows.map((row) => {
    const category = getMappedValue(csv, row, columnMapping.category);
    const incomeAccount = getMappedValue(csv, row, columnMapping.incomeAccountId);
    const outcomeAccount = getMappedValue(csv, row, columnMapping.outcomeAccountId);

    return {
      createdAt: getMappedValue(csv, row, columnMapping.createdAt),
      categoryId: category ? categoryBindings[category] : undefined,
      necessityLevel: toEnumValue(
        necessityLevelEnum.enumValues,
        getMappedValue(csv, row, columnMapping.necessityLevel),
      ),
      incomeAccountId: incomeAccount ? accountBindings[incomeAccount] : undefined,
      incomeAmount: getMappedValue(csv, row, columnMapping.incomeAmount),
      incomeCurrency: toEnumValue(
        currencyCodeEnum.enumValues,
        getMappedValue(csv, row, columnMapping.incomeCurrency),
      ),
      outcomeAccountId: outcomeAccount ? accountBindings[outcomeAccount] : undefined,
      outcomeAmount: getMappedValue(csv, row, columnMapping.outcomeAmount),
      outcomeCurrency: toEnumValue(
        currencyCodeEnum.enumValues,
        getMappedValue(csv, row, columnMapping.outcomeCurrency),
      ),
    };
  });
}
