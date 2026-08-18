import { formatMoney } from "~/utils/format-money";
import type { ProfileSummary } from "~/modules/accounts/compute-balances";

type Props = {
  profile: ProfileSummary;
  onSelect: () => void;
};

/** Clickable tile for one profile: name, current/savings balances, and an accounts/transactions summary. */
export function ProfileCard({ profile, onSelect }: Props) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="bg-surface border-border flex flex-col gap-3 rounded-xl border p-4 text-left transition-shadow hover:shadow-md"
    >
      <span className="text-text text-xl font-semibold">{profile.name}</span>
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between text-sm">
          <span className="text-text-muted">Current balance</span>
          <span className="font-mono">{formatMoney(profile.currentBalanceUsd, "USD")}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-text-muted">Savings balance</span>
          <span className="font-mono">{formatMoney(profile.savingsBalanceUsd, "USD")}</span>
        </div>
      </div>
      <span className="text-text-muted text-xs">
        {profile.accountCount} account{profile.accountCount === 1 ? "" : "s"} ·{" "}
        {profile.transactionCount} transaction{profile.transactionCount === 1 ? "" : "s"}
      </span>
    </button>
  );
}
