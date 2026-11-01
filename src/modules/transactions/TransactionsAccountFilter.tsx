import { useNavigate } from "@tanstack/react-router";
import { Select } from "~/components/Select";
import type { AccountWithBalance } from "~/modules/accounts/compute-balances";

type Props = {
  accounts: AccountWithBalance[];
  selected?: string;
  selectedId?: string;
};

/**
 * New selections use stable account ids; existing name-based URLs remain readable.
 */
export function TransactionsAccountFilter({ accounts, selected, selectedId }: Props) {
  const navigate = useNavigate({ from: "/transactions" });

  const handleValueChange = (accountId: string | undefined) => {
    void navigate({ search: (prev) => ({ ...prev, account: undefined, accountId }) });
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <label htmlFor="transaction-account-filter" className="text-text text-sm font-bold">
        Account
      </label>
      <Select
        id="transaction-account-filter"
        options={accounts.map((account) => ({ value: account.id, label: account.name }))}
        value={selectedId ?? accounts.find((account) => account.name === selected)?.id}
        onValueChange={handleValueChange}
        placeholder="All accounts"
        className="w-full md:min-w-40"
      />
    </div>
  );
}
