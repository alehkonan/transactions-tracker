import { formatMoney } from "~/utils/format-money";

type Props = {
  amountUsd: string;
};

/** Muted pill showing a non-USD amount's approximate USD value. */
export function ApproxUsdTag({ amountUsd }: Props) {
  return (
    <span className="bg-surface-muted text-text-muted inline-block rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap">
      {formatMoney(amountUsd, "USD")}
    </span>
  );
}
