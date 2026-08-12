import { Field } from "@base-ui/react/field";
import { Toggle } from "@base-ui/react/toggle";
import { TrashIcon } from "lucide-react";
import { useContext, useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { twMerge } from "tailwind-merge";
import { createAccount, deleteAccount, updateAccount } from "~/api/account.functions";
import { Button } from "~/components/Button";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import { DialogContext } from "~/components/Dialog";
import { InputControl } from "~/components/InputControl";
import { SelectControl } from "~/components/SelectControl";
import { ToggleGroupControl } from "~/components/ToggleGroupControl";
import { accountStatusEnum, accountTypeEnum, currencyCodeEnum } from "~/database/enums";
import { accountTypeIcons, accountTypeStyles } from "~/modules/accounts/account-type-tag";
import { syncNow } from "~/modules/sync/useSyncStore";
import { formatMoney } from "~/utils/format-money";
import type { AccountWithBalance } from "~/modules/accounts/compute-balances";

type AccountFormValues = {
  name: string;
  currencyCode: string;
  type: string;
  status: string;
  initialBalance: string;
};

type Props = {
  /** When set, the form edits this existing account instead of creating a new one. */
  account?: AccountWithBalance;
};

const currencyOptions = currencyCodeEnum.enumValues.map((value) => ({ value, label: value }));

const typeOptions = accountTypeEnum.enumValues.map((value) => ({
  value,
  label: value.charAt(0) + value.slice(1).toLowerCase(),
}));

const statusOptions = accountStatusEnum.enumValues.map((value) => ({
  value,
  label: value.charAt(0) + value.slice(1).toLowerCase(),
}));

function getDefaultValues(account?: AccountWithBalance): AccountFormValues {
  return {
    name: account?.name ?? "",
    currencyCode: account?.currencyCode ?? "USD",
    type: account?.type ?? "CURRENT",
    status: account?.status ?? "ACTIVE",
    initialBalance: account?.initialBalance ?? "0",
  };
}

/**
 * What the balance becomes for the typed opening amount: the account's transactions total
 * (its current balance minus its stored opening amount) still applies on top of the new one.
 */
function getProjectedBalance(account: AccountWithBalance, initialBalance: string): string {
  const typed = Number(initialBalance);
  if (initialBalance.trim() === "" || Number.isNaN(typed)) return account.balance;

  const transactionsCents =
    Math.round(Number(account.balance) * 100) - Math.round(Number(account.initialBalance) * 100);
  return ((Math.round(typed * 100) + transactionsCents) / 100).toFixed(2);
}

export function AccountForm({ account }: Props) {
  const { onClose } = useContext(DialogContext);
  const isEditing = Boolean(account);
  const { control, handleSubmit, reset, formState } = useForm<AccountFormValues>({
    defaultValues: getDefaultValues(account),
  });
  const [isDeleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, startDeleteTransition] = useTransition();
  const initialBalance = useWatch({ control, name: "initialBalance" });

  const handleDelete = () => {
    if (!account) return;
    startDeleteTransition(async () => {
      await deleteAccount({ data: account.id });
      onClose();
      // The write went to the server; a pull is what brings it back into the store the page reads.
      await syncNow();
    });
  };

  const onSubmit = handleSubmit(async (values) => {
    const input = {
      name: values.name,
      currencyCode: values.currencyCode as (typeof currencyCodeEnum.enumValues)[number],
      type: values.type as (typeof accountTypeEnum.enumValues)[number],
      status: values.status as (typeof accountStatusEnum.enumValues)[number],
      initialBalance: values.initialBalance,
    };

    if (account) {
      await updateAccount({ data: { id: account.id, ...input } });
    } else {
      await createAccount({ data: input });
    }

    if (!isEditing) reset(getDefaultValues());
    onClose();
    // Not awaited: the change can come back through a pull after the dialog closes.
    void syncNow();
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 pt-3">
      <ToggleGroupControl
        control={control}
        name="type"
        aria-label="Type"
        className="border-border bg-surface flex gap-1 rounded-lg border p-1"
      >
        {typeOptions.map((option) => {
          const Icon = accountTypeIcons[option.value];
          return (
            <Toggle
              key={option.value}
              value={option.value}
              className={(toggleState) =>
                twMerge(
                  "flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent text-sm transition-colors",
                  toggleState.pressed
                    ? accountTypeStyles[option.value]
                    : "text-text-muted hover:bg-surface-muted",
                )
              }
            >
              <Icon className="size-4" />
              {option.label}
            </Toggle>
          );
        })}
      </ToggleGroupControl>
      <div className="grid grid-cols-2 gap-3">
        <InputControl control={control} name="name" label="Name" rules={{ required: true }} />
        <SelectControl
          control={control}
          name="currencyCode"
          label="Currency"
          options={currencyOptions}
        />
        <SelectControl control={control} name="status" label="Status" options={statusOptions} />
        <InputControl
          control={control}
          name="initialBalance"
          label="Initial balance"
          inputMode="decimal"
        />
        {account && (
          <Field.Root className="flex flex-col gap-1">
            <Field.Label className="text-text text-sm font-bold">Balance</Field.Label>
            <Field.Control
              readOnly
              value={formatMoney(
                getProjectedBalance(account, initialBalance),
                account.currencyCode,
              )}
              className="border-border bg-surface-muted text-text-muted h-9 rounded-lg border px-2"
            />
            <Field.Description className="text-text-muted text-sm">
              Initial balance plus all transactions
            </Field.Description>
          </Field.Root>
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        {account && (
          <Button
            variant="danger"
            type="button"
            disabled={isDeleting}
            onClick={() => setDeleteOpen(true)}
          >
            <TrashIcon className="size-4" />
            Delete
          </Button>
        )}
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={formState.isSubmitting}>
            {isEditing ? "Save" : "Create"}
          </Button>
        </div>
      </div>
      {account && (
        <ConfirmDialog
          open={isDeleteOpen}
          onOpenChange={setDeleteOpen}
          title="Remove account"
          message={`Delete account "${account.name}"? This also deletes all of its transactions.`}
          confirmLabel="Delete"
          confirmVariant="danger"
          onConfirm={handleDelete}
        />
      )}
    </form>
  );
}
