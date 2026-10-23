import { use } from "react";
import { useForm, useWatch } from "react-hook-form";
import { DialogContext } from "~/components/Dialog";
import { useSyncStore } from "~/modules/sync/useSyncStore";
import {
  getDefaultFormValues,
  type TransactionFormValues,
} from "~/modules/transaction-form/transaction-form-values";
import { useAccountBalancePreview } from "~/modules/transaction-form/useAccountBalancePreview";
import { useTransactionFormSubmit } from "~/modules/transaction-form/useTransactionFormSubmit";
import { useTransferAmountMirror } from "~/modules/transaction-form/useTransferAmountMirror";
import { findLinkedTransfer } from "~/modules/transactions/linked-transfer";
import type { AccountWithBalance } from "~/modules/accounts/compute-balances";
import type { TransactionRow } from "~/modules/transactions/to-transaction-rows";

type Options = {
  accounts: AccountWithBalance[];
  /** When set, the form edits this existing row instead of creating a new one. */
  transaction?: TransactionRow;
};

export function useTransactionForm({ accounts, transaction }: Options) {
  const { onClose } = use(DialogContext);
  const isEditing = Boolean(transaction);
  const transactions = useSyncStore((state) => state.transactions);
  const isLinkedTransfer = Boolean(transaction?.transferId);
  const [outgoing, incoming] = findLinkedTransfer(transactions, transaction?.transferId) ?? [];
  const formTransaction = outgoing && transaction ? { ...transaction, ...outgoing } : transaction;

  const form = useForm<TransactionFormValues>({
    defaultValues: getDefaultFormValues(formTransaction, incoming),
  });
  const { control, handleSubmit, setValue, setError, reset, formState } = form;
  const type = useWatch({ control, name: "type" });

  const { selectedAccount, selectedToAccount, projectedBalance, projectedToBalance } =
    useAccountBalancePreview({
      accounts,
      control,
      transaction: formTransaction,
      incoming,
    });
  const { markToAmountTouched, reset: resetMirror } = useTransferAmountMirror({
    control,
    setValue,
    enabled:
      selectedAccount != null && selectedAccount.currencyCode === selectedToAccount?.currencyCode,
    initiallyTouched: isLinkedTransfer,
  });
  const { submit } = useTransactionFormSubmit({ transaction });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await submit(values);
      if (!isEditing) {
        reset(getDefaultFormValues(undefined));
        resetMirror();
      }
    } catch (error) {
      setError("root", {
        message:
          error instanceof Error
            ? error.message
            : isEditing
              ? "Failed to update transaction. Please try again."
              : "Failed to save transaction. Please try again.",
      });
    }
  });

  return {
    form,
    type,
    showTransferSplit: type === "TRANSFER" && (!isEditing || isLinkedTransfer),
    isLinkedTransfer,
    selectedAccount,
    selectedToAccount,
    projectedBalance,
    projectedToBalance,
    markToAmountTouched,
    onSubmit,
    onClose,
    isEditing,
    isPending: formState.isSubmitting,
    rootError: formState.errors.root?.message,
  };
}
