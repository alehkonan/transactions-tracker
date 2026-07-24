import { getTableColumns } from "drizzle-orm";
import { transactions } from "~/drizzle/schema";

export type TransactionField = {
  key: string;
  label: string;
  required: boolean;
};

const labels: Record<string, string> = {
  categoryId: "Category",
  necessityLevel: "Necessity level",
  incomeAmount: "Income amount",
  incomeAccountId: "Income account",
  incomeCurrencyCode: "Income currency",
  outcomeAmount: "Outcome amount",
  outcomeAccountId: "Outcome account",
  outcomeCurrencyCode: "Outcome currency",
  createdAt: "Created at",
  comment: "Comment",
};

/**
 * Importable transaction fields, derived from the Drizzle schema so the mapper
 * stays in sync with the table. The auto-generated primary key is excluded; a
 * field is `required` when its column is NOT NULL without a default.
 */
export const transactionFields: TransactionField[] = Object.entries(getTableColumns(transactions))
  .filter(([, column]) => !column.primary)
  .map(([key, column]) => ({
    key,
    label: labels[key] ?? key,
    required: column.notNull && !column.hasDefault,
  }));
