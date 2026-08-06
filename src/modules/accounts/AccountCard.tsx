import { useState } from "react";
import { twMerge } from "tailwind-merge";
import { Dialog } from "~/components/Dialog";
import { Title } from "~/components/Title";
import { formatMoney } from "~/utils/formatMoney";
import { AccountForm } from "./AccountForm";
import { AccountStatusChip } from "./AccountStatusChip";
import type { getAccounts } from "~/api/account.functions";

type Account = Awaited<ReturnType<typeof getAccounts>>[number];

type Props = {
  account: Account;
  /** Overrides the default "click opens the edit dialog" behavior — the collapsed peek stack uses this to expand the group on click instead. */
  onClick?: () => void;
};

/** Small "plastic card" tile summarizing one account: name, status, and balance. Click opens the edit dialog. */
export function AccountCard({ account, onClick }: Props) {
  const [isEditOpen, setEditOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={onClick ?? (() => setEditOpen(true))}
        className={twMerge(
          "from-surface flex aspect-8/5 w-full flex-col justify-between rounded-2xl bg-linear-to-br p-4 text-left shadow-sm",
          account.status === "ARCHIVED"
            ? "to-archived-muted/20 dark:to-archived-muted/30"
            : account.type === "CURRENT"
              ? "to-accent-muted"
              : "to-saving-muted dark:to-saving-muted-dark/50",
        )}
      >
        <div className="flex flex-col">
          <Title variant="tooltip">{account.name}</Title>
          <span className="text-text-muted text-xs capitalize">{account.type.toLowerCase()}</span>
        </div>
        <div className="flex items-end justify-between gap-2">
          <AccountStatusChip status={account.status} />
          <span className="font-mono text-xl leading-none font-semibold">
            {formatMoney(account.balance, account.currencyCode)}
          </span>
        </div>
      </button>
      <Dialog title="Edit account" open={isEditOpen} onOpenChange={setEditOpen}>
        <AccountForm account={account} />
      </Dialog>
    </>
  );
}
