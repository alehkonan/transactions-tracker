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
    setTimeout(() => {
      navigate({ search: (prev) => ({ ...prev, account }) });
    }, 0);
  };

  const handleReset = () => navigate({ search: (prev) => ({ ...prev, account: undefined }) });

  return (
    <Select
      options={accounts.map((account) => account.name)}
      value={selected}
      onValueChange={handleValueChange}
      onReset={selected ? handleReset : undefined}
      placeholder="All accounts"
      className="min-w-40"
    />
  );
}
