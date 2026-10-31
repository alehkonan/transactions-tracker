import { use } from "react";
import { FormTaskContext } from "~/modules/forms/form-task";
import { useSelectedProfileId } from "~/modules/profile/local-selection";
import { useReplicaBinding } from "~/modules/sync/useReplicaBinding";
import { useSyncStore } from "~/modules/sync/useSyncStore";
import {
  getSignedTransactionAmount,
  type TransactionFormValues,
} from "~/modules/transaction-form/transaction-form-values";
import {
  createTransactions,
  linkTransfers,
  updateTransaction,
  updateTransfer,
  type TransactionInput,
} from "~/modules/transactions/transaction-mutations";
import type { TransactionRow } from "~/modules/transactions/to-transaction-rows";

type Options = {
  /** When set, the form edits this existing row instead of creating a new one. */
  transaction?: TransactionRow;
};

/** Persists the submitted form values (create or update) and completes the task. Throws on failure. */
export function useTransactionFormSubmit({ transaction }: Options) {
  const { onComplete } = use(FormTaskContext);
  const replicaContext = useReplicaBinding();
  const profileId = useSelectedProfileId();

  const submit = async (values: TransactionFormValues) => {
    if (profileId == null || !replicaContext)
      throw new Error("Your local profile is unavailable. Reopen the form and try again.");

    const shared = {
      createdAt: values.createdAt,
      categoryId:
        values.type === "TRANSFER" && (!transaction || transaction.transferId)
          ? null
          : values.categoryId || null,
      necessityLevel: values.type === "EXPENSE" ? values.necessityLevel : "MEDIUM",
      comment: values.comment || null,
    } satisfies Partial<TransactionInput>;

    const signedAmount = getSignedTransactionAmount(
      values.amount,
      values.type,
      transaction?.transferId ? undefined : transaction,
    );

    if (transaction) {
      // The form works from the derived row; the stored one is what a mutation edits.
      const stored = useSyncStore.getState().transactions.find((row) => row.id === transaction.id);
      if (!stored) throw new Error("This transaction is no longer available.");

      if (stored.transferId) {
        await updateTransfer(
          stored,
          [
            {
              ...shared,
              type: "TRANSFER",
              accountId: values.accountId || null,
              amount: signedAmount,
              sphereId: values.sphereId || profileId,
            },
            {
              ...shared,
              type: "TRANSFER",
              accountId: values.toAccountId || null,
              amount: values.toAmount,
              sphereId: values.toSphereId || profileId,
            },
          ],
          replicaContext,
        );
      } else
        await updateTransaction(
          stored,
          {
            ...shared,
            type: values.type,
            accountId: values.accountId || null,
            amount: signedAmount,
            sphereId: values.sphereId || profileId,
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
                sphereId: values.sphereId || profileId,
              },
              {
                ...shared,
                type: "TRANSFER",
                accountId: values.toAccountId || null,
                amount: values.toAmount,
                sphereId: values.toSphereId || profileId,
              },
            ]
          : [
              {
                ...shared,
                type: values.type,
                accountId: values.accountId || null,
                amount: signedAmount,
                sphereId: values.sphereId || profileId,
              },
            ];

      await createTransactions(profileId, inputs, replicaContext);
    }

    onComplete();
  };

  const link = async (counterpartId: string) => {
    if (!transaction || !profileId || !replicaContext)
      throw new Error("Open a saved Transfer in the selected profile before linking.");
    await linkTransfers(profileId, [transaction.id, counterpartId], replicaContext);
    onComplete();
  };

  return { submit, link };
}
