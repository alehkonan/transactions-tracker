import { useNavigate } from "@tanstack/react-router";
import { Select } from "~/components/Select";
import type { AccountWithBalance } from "~/modules/accounts/compute-balances";

type Props = {
  accounts: AccountWithBalance[];
  selected?: string;
};

/**
 * Account filter for the transactions table; drives the `account` route search param (matched by
 * account name), so each pick re-runs the loader. Picking the placeholder item reports `undefined`,
 * which drops the param and brings every account back.
 */
export function TransactionsAccountFilter({ accounts, selected }: Props) {
  const navigate = useNavigate({ from: "/transactions" });

  const handleValueChange = (account: string | undefined) => {
    void navigate({ search: (prev) => ({ ...prev, account }) });
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <label htmlFor="transaction-account-filter" className="text-text text-sm font-bold">
        Account
      </label>
      <Select
        id="transaction-account-filter"
        options={accounts.map((account) => account.name)}
        value={selected}
        onValueChange={handleValueChange}
        placeholder="All accounts"
        className="w-full md:min-w-40"
      />
    </div>
  );
}
