import { use } from "react";
import { DialogContext } from "~/components/Dialog";
import { readSelectedProfileId } from "~/modules/profile/profile-cookie";
import { useSyncStore } from "~/modules/sync/useSyncStore";
import {
  isOutgoing,
  negateIfPositive,
  type TransactionFormValues,
} from "~/modules/transaction-form/transaction-form-values";
import {
  createTransactions,
  updateTransaction,
  type TransactionInput,
} from "~/modules/transactions/transaction-mutations";
import type { TransactionRow } from "~/modules/transactions/to-transaction-rows";

type Options = {
  /** When set, the form edits this existing row instead of creating a new one. */
  transaction?: TransactionRow;
};

/** Persists the submitted form values (create or update) and closes the dialog. Throws on failure. */
export function useTransactionFormSubmit({ transaction }: Options) {
  const { onClose } = use(DialogContext);

  const submit = async (values: TransactionFormValues) => {
    const profileId = readSelectedProfileId();
    if (profileId == null) return;

    const shared = {
      createdAt: values.createdAt,
      categoryId: values.categoryId || null,
      necessityLevel: values.necessityLevel || "MEDIUM",
      comment: values.comment || null,
    } satisfies Partial<TransactionInput>;

    const originalIsNegative = transaction?.amount.trim().startsWith("-") ?? false;
    const negative = isOutgoing(values.type, Boolean(transaction), originalIsNegative);

    if (transaction) {
      // The form works from the derived row; the stored one is what a mutation edits.
      const stored = useSyncStore.getState().transactions.find((row) => row.id === transaction.id);
      if (!stored) return;

      await updateTransaction(stored, {
        ...shared,
        type: values.type,
        accountId: values.accountId || null,
        amount: negative ? negateIfPositive(values.amount) : values.amount,
      });
    } else {
      // A transfer moves money between two of the user's own accounts, so it's
      // recorded as two TRANSFER-typed rows (one per account) rather than
      // EXPENSE+INCOME, keeping it out of spending/income statistics.
      const inputs: TransactionInput[] =
        values.type === "TRANSFER"
          ? [
              {
                ...shared,
                type: "TRANSFER",
                accountId: values.accountId || null,
                amount: negateIfPositive(values.amount),
              },
              {
                ...shared,
                type: "TRANSFER",
                accountId: values.toAccountId || null,
                amount: values.toAmount,
              },
            ]
          : [
              {
                ...shared,
                type: values.type,
                accountId: values.accountId || null,
                amount: negative ? negateIfPositive(values.amount) : values.amount,
              },
            ];

      await createTransactions(profileId, inputs);
    }

    onClose();
  };

  return { submit };
}
