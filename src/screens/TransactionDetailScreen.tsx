import { Toast } from "@base-ui/react/toast";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { useCallback } from "react";
import { Button } from "~/components/Button";
import { Dialog } from "~/components/Dialog";
import { PageContainer } from "~/components/PageContainer";
import { PageHeader } from "~/components/PageHeader";
import { useAccounts } from "~/modules/accounts/useAccounts";
import { useCategories } from "~/modules/categories/useCategories";
import { FormTaskContext, type FormTaskResult } from "~/modules/forms/form-task";
import { useRoutedFormTask } from "~/modules/forms/useRoutedFormTask";
import { useSelectedProfileId } from "~/modules/profile/local-selection";
import { useSyncStore } from "~/modules/sync/useSyncStore";
import { TransactionForm } from "~/modules/transaction-form/TransactionForm";
import { findLinkedTransfer } from "~/modules/transactions/linked-transfer";
import { useTransactionRows } from "~/modules/transactions/useTransactionRows";

export function TransactionDetailScreen({ transactionId }: { transactionId?: string }) {
  const profileId = useSelectedProfileId();
  const replicaId = useSyncStore((state) => state.replicaContext?.replicaId);
  // Changing the local identity must never keep another profile's draft alive.
  return (
    <TransactionDetail
      key={`${replicaId}:${profileId}:${transactionId ?? "new"}`}
      transactionId={transactionId}
    />
  );
}

function TransactionDetail({ transactionId }: { transactionId?: string }) {
  const router = useRouter();
  const location = useRouterState({ select: (state) => state.location });
  const profileId = useSelectedProfileId();
  const replicaId = useSyncStore((state) => state.replicaContext?.replicaId);
  const pending = useSyncStore((state) => state.pending);
  const status = useSyncStore((state) => state.status);
  const storedTransactions = useSyncStore((state) => state.transactions);
  const accounts = useAccounts();
  const categories = useCategories();
  const rows = useTransactionRows();
  const transaction = rows.find((row) => row.id === transactionId);
  const toastManager = Toast.useToastManager();
  const origin = location.state.transactionListOrigin;
  const canReturn =
    origin?.profileId === profileId &&
    origin?.replicaId === replicaId &&
    // oxlint-disable-next-line eslint/no-underscore-dangle -- TanStack Router's history state key.
    origin?.historyIndex === location.state.__TSR_index - 1;
  const returnToList = useCallback(
    (completed = false) => {
      if (canReturn) router.history.back({ ignoreBlocker: completed });
      else void router.navigate({ to: "/transactions", replace: true, ignoreBlocker: completed });
    },
    [canReturn, router],
  );
  const onCancel = useCallback(() => returnToList(), [returnToList]);
  const onComplete = useCallback(
    (result?: FormTaskResult) => {
      toastManager.add({
        description:
          result === "deleted"
            ? "Transaction deleted."
            : result === "linked"
              ? "Transfer linked."
              : "Transaction saved.",
        timeout: 3500,
      });
      returnToList(true);
    },
    [toastManager, returnToList],
  );
  const { task, blocker, isPending } = useRoutedFormTask({ onCancel, onComplete });
  // Default account/amount values must come from the complete pair, even when its incoming leg arrives first.
  const incompleteTransfer =
    Boolean(transaction?.transferId) &&
    !findLinkedTransfer(storedTransactions, transaction?.transferId);
  const loading =
    incompleteTransfer ||
    (!transaction && Boolean(transactionId) && pending.includes("transactions"));
  const needsAccount = !transactionId && !accounts.some((account) => account.status === "ACTIVE");

  return (
    <PageContainer className="pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
      <main className="mx-auto w-full max-w-2xl">
        <PageHeader
          title={transactionId ? "Transaction" : "Add transaction"}
          backLabel="Transactions"
          onBack={onCancel}
        />
        {loading ? (
          <section
            className="bg-surface rounded-lg p-4"
            aria-live="polite"
            data-testid="transaction-loading"
          >
            <h2 className="font-semibold">
              {status === "error" || status === "unauthorized"
                ? "Transaction not loaded yet"
                : "Loading transaction…"}
            </h2>
            <p className="text-text-muted mt-2 text-sm">
              {incompleteTransfer
                ? "Both sides of this transfer must reach this device before editing."
                : "This transaction has not reached this device yet."}{" "}
              Return to Transactions or check synchronization to continue.
            </p>
          </section>
        ) : transactionId && !transaction ? (
          <section className="bg-surface rounded-lg p-4" data-testid="transaction-unavailable">
            <h2 className="font-semibold">Transaction unavailable</h2>
            <p className="text-text-muted mt-2 text-sm">
              It may have been deleted, belong to another profile, or no longer be accessible in
              this profile.
            </p>
            <Button variant="secondary" className="mt-4" onClick={onCancel}>
              Return to Transactions
            </Button>
          </section>
        ) : needsAccount ? (
          <section className="bg-surface rounded-lg p-4" data-testid="transaction-needs-account">
            <h2 className="font-semibold">Create an active account first</h2>
            <p className="text-text-muted mt-2 text-sm">
              Add an account or reactivate an archived account in Money before recording a
              transaction.
            </p>
            <Button
              variant="primary"
              className="mt-4"
              onClick={() => void router.navigate({ to: "/accounts" })}
            >
              Go to Money
            </Button>
          </section>
        ) : (
          <FormTaskContext value={task}>
            <TransactionForm
              accounts={accounts}
              categories={categories}
              transaction={transaction}
            />
          </FormTaskContext>
        )}
        <Dialog
          title={isPending ? "Saving changes…" : "Discard changes?"}
          open={blocker.status === "blocked"}
          onOpenChange={(open) => {
            if (!open) blocker.reset?.();
          }}
          requireAction
        >
          <p className="mt-3 text-sm">
            {isPending
              ? "Wait for this local operation to finish before leaving."
              : "Your unsaved changes will be lost."}
          </p>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button
              variant="secondary"
              data-testid="discard-keep-editing"
              onClick={() => blocker.reset?.()}
            >
              Keep editing
            </Button>
            <Button
              variant="danger"
              data-testid="discard-confirm"
              disabled={isPending}
              onClick={() => blocker.proceed?.()}
            >
              Discard changes
            </Button>
          </div>
        </Dialog>
      </main>
    </PageContainer>
  );
}
