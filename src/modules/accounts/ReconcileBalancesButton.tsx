import { Loader2Icon, RefreshCwIcon } from "lucide-react";
import { useTransition } from "react";
import { reconcileAccountBalances } from "~/api/account.functions";
import { Button } from "~/components/Button";
import { Popover } from "~/components/Popover";
import { PopoverConfirm } from "~/components/PopoverConfirm";

/**
 * Recomputes every account's balance from its transaction history, fixing any drift.
 *
 * Server-side housekeeping: the balances on screen are derived from the transactions in the store, so
 * they cannot drift in the first place — this repairs the cached `accounts.balance` column, which
 * nothing in the UI reads any more.
 */
export function ReconcileBalancesButton() {
  const [isReconciling, startTransition] = useTransition();

  const handleConfirm = () => {
    startTransition(async () => {
      await reconcileAccountBalances();
    });
  };

  return (
    <Popover
      renderTrigger={({ onOpen }) => (
        <Button
          variant="secondary"
          aria-label="Reconcile account balances"
          disabled={isReconciling}
          onClick={onOpen}
        >
          {isReconciling ? (
            <Loader2Icon className="size-6 animate-spin" />
          ) : (
            <RefreshCwIcon className="size-6" />
          )}
        </Button>
      )}
    >
      <PopoverConfirm
        message="Recompute every account's balance from its transaction history?"
        confirmLabel="Reconcile"
        onConfirm={handleConfirm}
      />
    </Popover>
  );
}
