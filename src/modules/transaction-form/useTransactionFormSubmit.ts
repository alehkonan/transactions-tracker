import { use } from "react";
import { createTransactions, updateTransaction } from "~/api/transaction.functions";
import { DialogContext } from "~/components/Dialog";
import { syncNow } from "~/modules/sync/useSyncStore";
import {
  isOutgoing,
  negateIfPositive,
  type NecessityLevel,
  type TransactionFormValues,
  type TransactionType,
} from "~/modules/transaction-form/transaction-form-values";
import type { TransactionRow } from "~/modules/transactions/to-transaction-rows";

type CreateTransactionInput = {
  categoryId?: string;
  necessityLevel?: NecessityLevel;
  type: TransactionType;
  accountId?: string;
  amount: string;
  comment?: string;
};

type Options = {
  /** When set, the form edits this existing row instead of creating a new one. */
  transaction?: TransactionRow;
};

/** Persists the submitted form values (create or update) and closes the dialog. Throws on failure. */
export function useTransactionFormSubmit({ transaction }: Options) {
  const { onClose } = use(DialogContext);

  const submit = async (values: TransactionFormValues) => {
    const shared = {
      categoryId: values.categoryId || undefined,
      necessityLevel: values.necessityLevel || undefined,
      comment: values.comment || undefined,
    };

    const originalIsNegative = transaction?.amount.trim().startsWith("-") ?? false;
    const negative = isOutgoing(values.type, Boolean(transaction), originalIsNegative);

    if (transaction) {
      await updateTransaction({
        data: {
          id: transaction.id,
          ...shared,
          type: values.type,
          accountId: values.accountId,
          amount: negative ? negateIfPositive(values.amount) : values.amount,
        },
      });
    } else {
      // A transfer moves money between two of the user's own accounts, so it's
      // recorded as two TRANSFER-typed rows (one per account) rather than
      // EXPENSE+INCOME, keeping it out of spending/income statistics.
      const inputs: CreateTransactionInput[] =
        values.type === "TRANSFER"
          ? [
              {
                ...shared,
                type: "TRANSFER",
                accountId: values.accountId,
                amount: negateIfPositive(values.amount),
              },
              {
                ...shared,
                type: "TRANSFER",
                accountId: values.toAccountId,
                amount: values.toAmount,
              },
            ]
          : [
              {
                ...shared,
                type: values.type,
                accountId: values.accountId,
                amount: negative ? negateIfPositive(values.amount) : values.amount,
              },
            ];

      await createTransactions({ data: inputs });
    }

    await syncNow();
    onClose();
  };

  return { submit };
}
