import { Toggle } from "@base-ui/react/toggle";
import { useRouter } from "@tanstack/react-router";
import { TrashIcon } from "lucide-react";
import { useContext, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { twMerge } from "tailwind-merge";
import { createAccount, deleteAccount, updateAccount } from "~/api/account.functions";
import { Button } from "~/components/Button";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import { DialogContext } from "~/components/Dialog";
import { InputControl } from "~/components/InputControl";
import { SelectControl } from "~/components/SelectControl";
import { ToggleGroupControl } from "~/components/ToggleGroupControl";
import { accountStatusEnum, accountTypeEnum, currencyCodeEnum } from "~/database/enums";
import { accountTypeIcons, accountTypeStyles } from "~/modules/accounts/AccountTypeTag";
import type { getAccounts } from "~/api/account.functions";

type Account = Awaited<ReturnType<typeof getAccounts>>[number];

type AccountFormValues = {
  name: string;
  currencyCode: string;
  type: string;
  status: string;
  balance: string;
};

type Props = {
  /** When set, the form edits this existing account instead of creating a new one. */
  account?: Account;
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

function getDefaultValues(account?: Account): AccountFormValues {
  return {
    name: account?.name ?? "",
    currencyCode: account?.currencyCode ?? "USD",
    type: account?.type ?? "CURRENT",
    status: account?.status ?? "ACTIVE",
    balance: account?.balance ?? "0",
  };
}

export function AccountForm({ account }: Props) {
  const { onClose } = useContext(DialogContext);
  const router = useRouter();
  const isEditing = Boolean(account);
  const { control, handleSubmit, reset, formState } = useForm<AccountFormValues>({
    defaultValues: getDefaultValues(account),
  });
  const [isDeleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, startDeleteTransition] = useTransition();

  const handleDelete = () => {
    if (!account) return;
    startDeleteTransition(async () => {
      await deleteAccount({ data: account.id });
      onClose();
      await router.invalidate();
    });
  };

  const onSubmit = handleSubmit(async (values) => {
    const input = {
      name: values.name,
      currencyCode: values.currencyCode as (typeof currencyCodeEnum.enumValues)[number],
      type: values.type as (typeof accountTypeEnum.enumValues)[number],
      status: values.status as (typeof accountStatusEnum.enumValues)[number],
      balance: values.balance,
    };

    if (account) {
      await updateAccount({ data: { id: account.id, ...input } });
    } else {
      await createAccount({ data: input });
    }

    if (!isEditing) reset(getDefaultValues());
    onClose();
    // Not awaited: the route data can refetch in the background after the dialog closes.
    void router.invalidate();
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
          name="balance"
          label={isEditing ? "Balance" : "Initial balance"}
          inputMode="decimal"
        />
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
