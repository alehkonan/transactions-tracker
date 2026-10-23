import { useWatch, type Control } from "react-hook-form";
import {
  calculateAccountBalancePreview,
  type TransactionFormValues,
} from "~/modules/transaction-form/transaction-form-values";
import { negateMoney, sumMoney } from "~/utils/money";
import type { AccountWithBalance } from "~/modules/accounts/compute-balances";
import type { TransactionRow } from "~/modules/transactions/to-transaction-rows";

type Options = {
  accounts: AccountWithBalance[];
  control: Control<TransactionFormValues>;
  /** When set, the row being edited — its existing sign is kept regardless of the selected type. */
  transaction?: TransactionRow;
  incoming?: Pick<TransactionRow, "accountId" | "amount">;
};

function projectIncomingBalance(
  account: AccountWithBalance | undefined,
  amount: string,
): string | undefined {
  const trimmedAmount = amount.trim();
  if (!account || !trimmedAmount || !Number.isFinite(Number(trimmedAmount))) return undefined;
  return sumMoney([account.balance, trimmedAmount]);
}

/** Resolves the selected account(s) and what their balance will become once the typed amount is applied. */
export function useAccountBalancePreview({ accounts, control, transaction, incoming }: Options) {
  const type = useWatch({ control, name: "type" });
  const accountId = useWatch({ control, name: "accountId" });
  const toAccountId = useWatch({ control, name: "toAccountId" });
  const amount = useWatch({ control, name: "amount" });
  const toAmount = useWatch({ control, name: "toAmount" });

  const selectedAccount = accounts.find((account) => account.id === accountId);
  const selectedToAccount = accounts.find((account) => account.id === toAccountId);

  return {
    selectedAccount,
    selectedToAccount,
    projectedBalance: selectedAccount
      ? calculateAccountBalancePreview({
          balance:
            incoming?.accountId === selectedAccount.id
              ? sumMoney([selectedAccount.balance, negateMoney(incoming.amount)])
              : selectedAccount.balance,
          selectedAccountId: selectedAccount.id,
          amount,
          type,
          transaction,
        })
      : undefined,
    projectedToBalance:
      selectedToAccount && incoming
        ? calculateAccountBalancePreview({
            balance:
              transaction?.accountId === selectedToAccount.id
                ? sumMoney([selectedToAccount.balance, negateMoney(transaction.amount)])
                : selectedToAccount.balance,
            selectedAccountId: selectedToAccount.id,
            amount: toAmount,
            type: "TRANSFER",
            transaction: incoming,
          })
        : projectIncomingBalance(selectedToAccount, toAmount),
  };
}
