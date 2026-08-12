import { necessityLevelEnum, transactionTypeEnum } from "~/database/enums";
import type { TransactionRow } from "~/api/transaction.functions";

export type NecessityLevel = (typeof necessityLevelEnum.enumValues)[number];
export type TransactionType = (typeof transactionTypeEnum.enumValues)[number];

export type TransactionFormValues = {
  type: TransactionType;
  accountId: string;
  toAccountId: string;
  amount: string;
  toAmount: string;
  categoryId: string;
  necessityLevel: NecessityLevel | "";
  comment: string;
};

export function getDefaultFormValues(
  transaction: TransactionRow | undefined,
): TransactionFormValues {
  return {
    type: transaction?.type ?? "EXPENSE",
    accountId: transaction?.accountId ?? "",
    toAccountId: "",
    amount: transaction?.amount.replace(/^-/, "") ?? "",
    toAmount: "",
    categoryId: transaction?.categoryId ?? "",
    necessityLevel: transaction?.necessityLevel ?? "",
    comment: transaction?.comment ?? "",
  };
}

/** Outgoing amounts (expenses, and the source leg of a transfer) are stored negative; users type a positive number and this flips its sign. */
export function negateIfPositive(amount: string): string {
  const trimmed = amount.trim();
  return trimmed.startsWith("-") ? trimmed : `-${trimmed}`;
}

/**
 * Whether the "amount" field (the single field outside create-mode transfers,
 * or the "from" leg when creating one) should be recorded as negative. A
 * TRANSFER row's sign is which leg it is, which can't be re-derived from the
 * form when editing, so the row's existing sign is kept instead of reset by type.
 */
export function isOutgoing(
  type: TransactionType,
  isEditing: boolean,
  originalIsNegative: boolean,
): boolean {
  if (type === "EXPENSE") return true;
  if (type === "INCOME") return false;
  return isEditing ? originalIsNegative : true;
}
