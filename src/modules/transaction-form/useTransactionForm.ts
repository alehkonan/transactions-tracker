import { use } from "react";
import { useForm, useWatch } from "react-hook-form";
import { DialogContext } from "~/components/Dialog";
import {
  getDefaultFormValues,
  type TransactionFormValues,
} from "~/modules/transaction-form/transaction-form-values";
import { useAccountBalancePreview } from "~/modules/transaction-form/useAccountBalancePreview";
import { useTransactionFormSubmit } from "~/modules/transaction-form/useTransactionFormSubmit";
import { useTransferAmountMirror } from "~/modules/transaction-form/useTransferAmountMirror";
import type { getAccounts } from "~/api/account.functions";
import type { TransactionRow } from "~/api/transaction.functions";

type Account = Awaited<ReturnType<typeof getAccounts>>[number];

type Options = {
  accounts: Account[];
  /** When set, the form edits this existing row instead of creating a new one. */
  transaction?: TransactionRow;
};

export function useTransactionForm({ accounts, transaction }: Options) {
  const { onClose } = use(DialogContext);
  const isEditing = Boolean(transaction);

  const form = useForm<TransactionFormValues>({ defaultValues: getDefaultFormValues(transaction) });
  const { control, handleSubmit, setValue, setError, reset, formState } = form;
  const type = useWatch({ control, name: "type" });

  const { markToAmountTouched, reset: resetMirror } = useTransferAmountMirror({
    control,
    setValue,
  });
  const { selectedAccount, selectedToAccount, projectedBalance, projectedToBalance } =
    useAccountBalancePreview({
      accounts,
      control,
      transaction,
    });
  const { submit } = useTransactionFormSubmit({ transaction });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await submit(values);
      if (!isEditing) {
        reset(getDefaultFormValues(undefined));
        resetMirror();
      }
    } catch {
      setError("root", {
        message: isEditing
          ? "Failed to update transaction. Please try again."
          : "Failed to save transaction. Please try again.",
      });
    }
  });

  return {
    form,
    type,
    // The two-account split view only makes sense when creating a transfer pair;
    // editing always touches a single existing row, even for TRANSFER-typed ones.
    showTransferSplit: type === "TRANSFER" && !isEditing,
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
