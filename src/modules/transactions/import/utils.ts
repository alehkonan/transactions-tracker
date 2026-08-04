import { necessityLevelEnum, transactionTypeEnum } from "~/database/enums";
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
type TransactionType = (typeof transactionTypeEnum.enumValues)[number];

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
  type: TransactionType;
  accountId?: number;
  amount: string;
};

/**
 * Builds one `transactionsTable` insert row per side of each CSV row: an outcome
 * account/amount becomes an EXPENSE row and an income account/amount becomes an
 * INCOME row on that account. Rows with both are transfers between own accounts,
 * so both legs are tagged TRANSFER instead so they're excluded from spending/income
 * statistics.
 */
export function buildTransactionInputs(
  csv: ParsedCsv,
  columnMapping: ColumnMapping,
  accountBindings: Bindings,
  categoryBindings: Bindings,
): TransactionInput[] {
  const inputs: TransactionInput[] = [];

  for (const row of csv.rows) {
    const category = getMappedValue(csv, row, columnMapping.category);
    const incomeAccount = getMappedValue(csv, row, columnMapping.incomeAccountId);
    const outcomeAccount = getMappedValue(csv, row, columnMapping.outcomeAccountId);
    const incomeAmount = getMappedValue(csv, row, columnMapping.incomeAmount);
    const outcomeAmount = getMappedValue(csv, row, columnMapping.outcomeAmount);
    const isTransfer = incomeAccount !== undefined && outcomeAccount !== undefined;

    const shared = {
      createdAt: getMappedValue(csv, row, columnMapping.createdAt),
      categoryId: category ? categoryBindings[category] : undefined,
      necessityLevel: toEnumValue(
        necessityLevelEnum.enumValues,
        getMappedValue(csv, row, columnMapping.necessityLevel),
      ),
    };

    if (outcomeAccount !== undefined && outcomeAmount !== undefined) {
      inputs.push({
        ...shared,
        type: isTransfer ? "TRANSFER" : "EXPENSE",
        accountId: accountBindings[outcomeAccount],
        amount: outcomeAmount,
      });
    }

    if (incomeAccount !== undefined && incomeAmount !== undefined) {
      inputs.push({
        ...shared,
        type: isTransfer ? "TRANSFER" : "INCOME",
        accountId: accountBindings[incomeAccount],
        amount: incomeAmount,
      });
    }
  }

  return inputs;
}
