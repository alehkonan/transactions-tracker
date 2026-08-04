import { useWatch, type Control } from "react-hook-form";
import {
  isOutgoing,
  type TransactionFormValues,
} from "~/modules/transaction-form/transactionFormValues";
import type { getAccounts } from "~/api/account.functions";
import type { TransactionRow } from "~/api/transaction.functions";

type Account = Awaited<ReturnType<typeof getAccounts>>[number];

type Options = {
  accounts: Account[];
  control: Control<TransactionFormValues>;
  /** When set, the row being edited — its existing sign is kept regardless of the selected type. */
  transaction?: TransactionRow;
};

function projectBalance(
  account: Account | undefined,
  amount: string,
  negative: boolean,
): number | undefined {
  if (!account || !amount) return undefined;
  const delta = Number(amount);
  if (Number.isNaN(delta)) return undefined;
  return Number(account.balance) + (negative ? -delta : delta);
}

/** Resolves the selected account(s) and what their balance will become once the typed amount is applied. */
export function useAccountBalancePreview({ accounts, control, transaction }: Options) {
  const type = useWatch({ control, name: "type" });
  const accountId = useWatch({ control, name: "accountId" });
  const toAccountId = useWatch({ control, name: "toAccountId" });
  const amount = useWatch({ control, name: "amount" });
  const toAmount = useWatch({ control, name: "toAmount" });

  const originalIsNegative = transaction?.amount.trim().startsWith("-") ?? false;
  const negative = isOutgoing(type, Boolean(transaction), originalIsNegative);

  const selectedAccount = accounts.find((account) => String(account.id) === accountId);
  const selectedToAccount = accounts.find((account) => String(account.id) === toAccountId);

  return {
    selectedAccount,
    selectedToAccount,
    projectedBalance: projectBalance(selectedAccount, amount, negative),
    projectedToBalance: projectBalance(selectedToAccount, toAmount, false),
  };
}
