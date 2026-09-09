import { necessityLevelEnum, transactionTypeEnum } from "~/database/enums";
import { negateMoney, sumMoney } from "~/utils/money";
import type { TransactionRow } from "~/modules/transactions/to-transaction-rows";

type NecessityLevel = (typeof necessityLevelEnum.enumValues)[number];
export type TransactionType = (typeof transactionTypeEnum.enumValues)[number];

export type TransactionFormValues = {
  type: TransactionType;
  /** When the money moved — not when the row was typed, which is only the default. */
  createdAt: Date;
  accountId: string;
  toAccountId: string;
  amount: string;
  toAmount: string;
  categoryId: string;
  necessityLevel: NecessityLevel;
  comment: string;
};

export function getDefaultFormValues(
  transaction: TransactionRow | undefined,
): TransactionFormValues {
  return {
    type: transaction?.type ?? "EXPENSE",
    createdAt: transaction?.createdAt ?? new Date(),
    accountId: transaction?.accountId ?? "",
    toAccountId: "",
    amount: transaction?.amount.replace(/^-/, "") ?? "",
    toAmount: "",
    categoryId: transaction?.categoryId ?? "",
    necessityLevel: transaction?.type === "EXPENSE" ? transaction.necessityLevel : "MEDIUM",
    comment: transaction?.comment ?? "",
  };
}

/** Outgoing amounts (expenses, and the source leg of a transfer) are stored negative; users type a positive number and this flips its sign. */
export function negateIfPositive(amount: string): string {
  const trimmed = amount.trim();
  return trimmed.startsWith("-") ? trimmed : negateMoney(trimmed);
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

type PreviewTransaction = Pick<TransactionRow, "accountId" | "amount">;

type AccountBalancePreviewOptions = {
  balance: string;
  selectedAccountId: string;
  amount: string;
  type: TransactionType;
  transaction?: PreviewTransaction;
};

/** Applies the same sign rule used for persistence to an amount typed into the form. */
export function getSignedTransactionAmount(
  amount: string,
  type: TransactionType,
  transaction?: Pick<TransactionRow, "amount">,
): string {
  const originalIsNegative = transaction?.amount.trim().startsWith("-") ?? false;
  return isOutgoing(type, Boolean(transaction), originalIsNegative)
    ? negateIfPositive(amount)
    : amount.trim();
}

/**
 * Projects the selected account's balance. When editing on the original account, the balance already
 * contains the old row, so that signed amount is reversed before the edited amount is applied.
 */
export function calculateAccountBalancePreview({
  balance,
  selectedAccountId,
  amount,
  type,
  transaction,
}: AccountBalancePreviewOptions): string | undefined {
  const trimmedAmount = amount.trim();
  if (!trimmedAmount || !Number.isFinite(Number(trimmedAmount))) return undefined;

  const signedAmount = getSignedTransactionAmount(trimmedAmount, type, transaction);
  const originalAmount =
    transaction?.accountId === selectedAccountId ? transaction.amount : undefined;

  return sumMoney([
    balance,
    ...(originalAmount === undefined ? [] : [negateMoney(originalAmount)]),
    signedAmount,
  ]);
}
