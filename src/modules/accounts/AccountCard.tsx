import { Title } from "~/components/Title";
import { formatMoney } from "~/utils/formatMoney";
import { AccountStatusChip } from "./AccountStatusChip";
import { DeleteAccountButton } from "./DeleteAccountButton";
import type { getAccounts } from "~/api/account.functions";

type Account = Awaited<ReturnType<typeof getAccounts>>[number];

type Props = {
  account: Account;
};

/** Small "plastic card" tile summarizing one account: name, status, and balance. */
export function AccountCard({ account }: Props) {
  return (
    <div className="from-surface to-accent-muted flex aspect-[8/5] flex-col justify-between rounded-2xl bg-gradient-to-br p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <Title variant="tooltip">{account.name}</Title>
        <DeleteAccountButton id={account.id} name={account.name} />
      </div>
      <div className="flex items-end justify-between gap-2">
        <AccountStatusChip status={account.status} />
        <span className="font-mono text-xl leading-none font-semibold">
          {formatMoney(account.balance, account.currencyCode)}
        </span>
      </div>
    </div>
  );
}
