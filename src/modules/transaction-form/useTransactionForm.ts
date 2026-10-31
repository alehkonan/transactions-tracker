import { format } from "date-fns";
import { useEffect, useRef, useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useFormTask } from "~/modules/forms/form-task";
import { useSelectedProfileId } from "~/modules/profile/local-selection";
import { sphereLabel } from "~/modules/spheres/sphere-label";
import { useSyncStore } from "~/modules/sync/useSyncStore";
import {
  getDefaultFormValues,
  getSignedTransactionAmount,
  type TransactionFormValues,
} from "~/modules/transaction-form/transaction-form-values";
import { useAccountBalancePreview } from "~/modules/transaction-form/useAccountBalancePreview";
import { useTransactionFormSubmit } from "~/modules/transaction-form/useTransactionFormSubmit";
import { useTransferAmountMirror } from "~/modules/transaction-form/useTransferAmountMirror";
import { findLinkedTransfer } from "~/modules/transactions/linked-transfer";
import { formatMoney } from "~/utils/format-money";
import { isMoneyInput, sumMoney } from "~/utils/money";
import type { AccountWithBalance } from "~/modules/accounts/compute-balances";
import type { TransactionRow } from "~/modules/transactions/to-transaction-rows";

type Options = {
  accounts: AccountWithBalance[];
  /** When set, the form edits this existing row instead of creating a new one. */
  transaction?: TransactionRow;
};

export function useTransactionForm({ accounts, transaction }: Options) {
  const isEditing = Boolean(transaction);
  const transactions = useSyncStore((state) => state.transactions);
  const allocations = useSyncStore((state) => state.allocations);
  const spheres = useSyncStore((state) => state.spheres);
  const pending = useSyncStore((state) => state.pending);
  const profileId = useSelectedProfileId();
  const isLinkedTransfer = Boolean(transaction?.transferId);
  const [outgoing, incoming] = findLinkedTransfer(transactions, transaction?.transferId) ?? [];
  const allocationFor = (id: string) =>
    allocations.find((row) => row.transactionId === id && row.deletedAt == null);
  const formSource = outgoing ?? transaction;
  const formTransaction =
    transaction && formSource
      ? { ...transaction, ...formSource, sphereId: allocationFor(formSource.id)?.sphereId }
      : undefined;
  const incomingWithSphere = incoming
    ? { ...incoming, sphereId: allocationFor(incoming.id)?.sphereId }
    : undefined;
  const attributionReady =
    !transaction ||
    Boolean(
      allocationFor(transaction.id) &&
      (!isLinkedTransfer ||
        (outgoing && incoming && allocationFor(outgoing.id) && allocationFor(incoming.id))),
    );
  const balancesComplete = !pending.some((table) =>
    ["accounts", "transactions", "spheres", "allocations"].includes(table),
  );

  const defaults = getDefaultFormValues(formTransaction, incomingWithSphere);
  const form = useForm<TransactionFormValues>({
    defaultValues: {
      ...defaults,
      sphereId: defaults.sphereId === profileId ? "" : defaults.sphereId,
      toSphereId: defaults.toSphereId === profileId ? "" : defaults.toSphereId,
    },
  });
  const { control, handleSubmit, setValue, setError, reset, formState } = form;
  const attributionInitialized = useRef(attributionReady);
  useEffect(() => {
    if (attributionInitialized.current || !attributionReady) return;
    setValue("sphereId", defaults.sphereId === profileId ? "" : defaults.sphereId);
    setValue("toSphereId", defaults.toSphereId === profileId ? "" : defaults.toSphereId);
    attributionInitialized.current = true;
  }, [attributionReady, defaults.sphereId, defaults.toSphereId, profileId, setValue]);
  const type = useWatch({ control, name: "type" });
  const [sphereId, toSphereId, amount, toAmount] = useWatch({
    control,
    name: ["sphereId", "toSphereId", "amount", "toAmount"],
  });
  const ownedSpheres = spheres.filter(
    (row) => row.profileId === profileId && row.deletedAt == null,
  );
  const sphereOptions = [
    { value: "", label: "Operating" },
    ...ownedSpheres
      .filter(
        (row) =>
          row.type !== "OPERATING" &&
          (!row.archived || row.id === sphereId || row.id === toSphereId),
      )
      .toSorted((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name))
      .map((row) => ({
        value: row.id,
        label: sphereLabel(row) + (row.archived ? " (archived)" : ""),
        disabled: row.archived,
      })),
  ];

  const { selectedAccount, selectedToAccount, projectedBalance, projectedToBalance } =
    useAccountBalancePreview({
      accounts,
      control,
      transaction: formTransaction,
      incoming,
    });
  const { markToAmountTouched, reset: resetMirror } = useTransferAmountMirror({
    control,
    setValue,
    enabled:
      selectedAccount != null && selectedAccount.currencyCode === selectedToAccount?.currencyCode,
    initiallyTouched: isLinkedTransfer,
  });
  const { submit, link } = useTransactionFormSubmit({ transaction });
  const [counterpartId, setCounterpartId] = useState("");
  const [isLinking, startLinking] = useTransition();
  const { onCancel } = useFormTask({
    isDirty: formState.isDirty || counterpartId !== "",
    isPending: formState.isSubmitting || isLinking,
  });
  const counterpartOptions = transactions
    .filter(
      (row) =>
        row.id !== transaction?.id &&
        row.profileId === profileId &&
        row.type === "TRANSFER" &&
        !row.transferId &&
        row.deletedAt == null,
    )
    .map((row) => {
      const account = accounts.find((candidate) => candidate.id === row.accountId);
      return {
        value: row.id,
        label: `${format(row.createdAt, "MMM d, yyyy HH:mm")} · ${account?.name ?? "Unknown account"} · ${account ? formatMoney(row.amount, account.currencyCode) : row.amount}${row.comment ? ` · ${row.comment}` : ""}`,
      };
    });
  const linkCounterpart = () => {
    if (formState.isDirty) {
      setError("root", { message: "Save or discard your edits before linking the saved records." });
      return;
    }
    startLinking(async () => {
      try {
        await link(counterpartId);
      } catch (error) {
        setError("root", {
          message:
            error instanceof Error ? error.message : "Could not link these records. Try again.",
        });
      }
    });
  };
  const split = type === "TRANSFER" && (!isEditing || isLinkedTransfer);
  const editedIds = new Set(isLinkedTransfer ? [outgoing?.id, incoming?.id] : [transaction?.id]);
  const effects = [
    ...(selectedAccount && isMoneyInput(amount) && Number(amount) > 0
      ? [
          {
            sphereId: sphereId || profileId,
            currencyCode: selectedAccount.currencyCode,
            amount: getSignedTransactionAmount(amount, type, formTransaction),
          },
        ]
      : []),
    ...(split && selectedToAccount && isMoneyInput(toAmount) && Number(toAmount) > 0
      ? [
          {
            sphereId: toSphereId || profileId,
            currencyCode: selectedToAccount.currencyCode,
            amount: toAmount,
          },
        ]
      : []),
  ];
  const sphereWarnings = effects
    .filter(
      (effect, index) =>
        Number(effect.amount) < 0 &&
        effects.findIndex(
          (other) =>
            other.sphereId === effect.sphereId &&
            other.currencyCode === effect.currencyCode &&
            Number(other.amount) < 0,
        ) === index,
    )
    .flatMap((effect) => {
      const balance = sumMoney([
        ...allocations
          .filter(
            (row) =>
              row.profileId === profileId &&
              row.sphereId === effect.sphereId &&
              row.currencyCode === effect.currencyCode &&
              row.deletedAt == null &&
              !editedIds.has(row.transactionId ?? undefined),
          )
          .map((row) => row.amount),
        ...effects
          .filter(
            (row) => row.sphereId === effect.sphereId && row.currencyCode === effect.currencyCode,
          )
          .map((row) => row.amount),
      ]);
      const sphere = ownedSpheres.find((row) => row.id === effect.sphereId);
      return Number(balance) < 0
        ? [
            {
              label: sphere ? sphereLabel(sphere) : "Operating",
              balance,
              currencyCode: effect.currencyCode,
            },
          ]
        : [];
    });

  const onSubmit = handleSubmit(async (values) => {
    try {
      if (!attributionReady)
        throw new Error("Finish loading this transaction's sphere before editing.");
      await submit(values);
      if (!isEditing) {
        reset(getDefaultFormValues(undefined));
        resetMirror();
      }
    } catch (error) {
      setError("root", {
        message:
          error instanceof Error
            ? error.message
            : isEditing
              ? "Failed to update transaction. Please try again."
              : "Failed to save transaction. Please try again.",
      });
    }
  });

  return {
    form,
    type,
    showTransferSplit: split,
    sphereOptions,
    sphereWarnings: balancesComplete ? sphereWarnings : [],
    balancesComplete,
    attributionReady,
    isLinkedTransfer,
    selectedAccount,
    selectedToAccount,
    projectedBalance,
    projectedToBalance,
    markToAmountTouched,
    onSubmit,
    onCancel,
    isEditing,
    isPending: formState.isSubmitting,
    rootError: formState.errors.root?.message,
    counterpartId,
    setCounterpartId,
    counterpartOptions,
    linkCounterpart,
    isLinking,
  };
}
