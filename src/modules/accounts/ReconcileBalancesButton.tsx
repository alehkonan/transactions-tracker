import { useRouter } from "@tanstack/react-router";
import { Loader2Icon, RefreshCwIcon } from "lucide-react";
import { useTransition } from "react";
import { reconcileAccountBalances } from "~/api/account.functions";
import { Button } from "~/components/Button";
import { Popover } from "~/components/Popover";
import { PopoverConfirm } from "~/components/PopoverConfirm";

/** Recomputes every account's balance from its transaction history, fixing any drift. */
export function ReconcileBalancesButton() {
  const router = useRouter();
  const [isReconciling, startTransition] = useTransition();

  const handleConfirm = () => {
    startTransition(async () => {
      await reconcileAccountBalances();
      await router.invalidate();
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
