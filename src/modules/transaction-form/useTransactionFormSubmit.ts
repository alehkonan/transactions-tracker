import { use } from "react";
import { DialogContext } from "~/components/Dialog";
import { readSelectedProfileId } from "~/modules/profile/profile-cookie";
import { useSyncStore } from "~/modules/sync/useSyncStore";
import {
  getSignedTransactionAmount,
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
  const replicaContext = useSyncStore((state) => state.replicaContext);

  const submit = async (values: TransactionFormValues) => {
    const profileId = readSelectedProfileId();
    if (profileId == null || !replicaContext) return;

    const shared = {
      createdAt: values.createdAt,
      categoryId: values.categoryId || null,
      necessityLevel: values.type === "EXPENSE" ? values.necessityLevel : "MEDIUM",
      comment: values.comment || null,
    } satisfies Partial<TransactionInput>;

    const signedAmount = getSignedTransactionAmount(values.amount, values.type, transaction);

    if (transaction) {
      // The form works from the derived row; the stored one is what a mutation edits.
      const stored = useSyncStore.getState().transactions.find((row) => row.id === transaction.id);
      if (!stored) return;

      await updateTransaction(
        stored,
        {
          ...shared,
          type: values.type,
          accountId: values.accountId || null,
          amount: signedAmount,
        },
        replicaContext,
      );
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
                amount: signedAmount,
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
                amount: signedAmount,
              },
            ];

      await createTransactions(profileId, inputs, replicaContext);
    }

    onClose();
  };

  return { submit };
}
