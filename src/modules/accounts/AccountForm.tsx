import { TrashIcon } from "lucide-react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { Button } from "~/components/Button";
import { InputControl } from "~/components/InputControl";
import { Popover } from "~/components/Popover";
import { PopoverConfirm } from "~/components/PopoverConfirm";
import { SelectControl } from "~/components/SelectControl";
import { accountStatusEnum, currencyCodeEnum } from "~/database/enums";
import { createAccount, deleteAccount, updateAccount } from "~/modules/accounts/account-mutations";
import { useFormTask } from "~/modules/forms/form-task";
import { useSelectedProfileId } from "~/modules/profile/local-selection";
import { useReplicaBinding } from "~/modules/sync/useReplicaBinding";
import { formatMoney } from "~/utils/format-money";
import { isMoneyInput } from "~/utils/money";
import type { AccountWithBalance } from "~/modules/accounts/compute-balances";

type AccountFormValues = {
  name: string;
  currencyCode: string;
  status: string;
  initialBalance: string;
};

type Props = {
  /** When set, the form edits this existing account instead of creating a new one. */
  account?: AccountWithBalance;
};

const currencyOptions = currencyCodeEnum.enumValues.map((value) => ({ value, label: value }));

const statusOptions = accountStatusEnum.enumValues.map((value) => ({
  value,
  label: value.charAt(0) + value.slice(1).toLowerCase(),
}));

function getDefaultValues(account?: AccountWithBalance): AccountFormValues {
  return {
    name: account?.name ?? "",
    currencyCode: account?.currencyCode ?? "USD",
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
  if (!isMoneyInput(initialBalance, { allowNegative: true })) return account.balance;

  const transactionsCents =
    Math.round(Number(account.balance) * 100) - Math.round(Number(account.initialBalance) * 100);
  return ((Math.round(typed * 100) + transactionsCents) / 100).toFixed(2);
}

export function AccountForm({ account }: Props) {
  const replicaContext = useReplicaBinding();
  const profileId = useSelectedProfileId();
  const isEditing = Boolean(account);
  const { control, handleSubmit, reset, setError, formState } = useForm<AccountFormValues>({
    defaultValues: getDefaultValues(account),
  });
  const [isDeleting, setIsDeleting] = useState(false);
  const initialBalance = useWatch({ control, name: "initialBalance" });

  const handleDelete = async () => {
    if (!account || !replicaContext) return;
    setIsDeleting(true);
    try {
      await deleteAccount(account, replicaContext);
      onComplete();
    } finally {
      setIsDeleting(false);
    }
  };

  const { onCancel, onComplete } = useFormTask({
    isDirty: formState.isDirty,
    isPending: formState.isSubmitting || isDeleting,
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      if (profileId == null || !replicaContext)
        throw new Error("Your local profile is unavailable. Reopen the form and try again.");

      const input = {
        name: values.name,
        currencyCode: values.currencyCode as (typeof currencyCodeEnum.enumValues)[number],
        status: values.status as (typeof accountStatusEnum.enumValues)[number],
        initialBalance: values.initialBalance,
      };

      // Both land in the store before this resolves, so the dialog closes onto the change itself
      // rather than onto the round trip that will carry it to the server.
      if (account) {
        await updateAccount(account, input, replicaContext);
      } else {
        await createAccount(profileId, input, replicaContext);
      }

      if (!isEditing) reset(getDefaultValues());
      onComplete();
    } catch (cause) {
      setError("root", {
        message: cause instanceof Error ? cause.message : "Could not save your changes. Try again.",
      });
    }
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 pt-3" data-testid="account-form">
      {formState.errors.root?.message && (
        <p role="alert" className="text-danger text-sm">
          {formState.errors.root.message}
        </p>
      )}
      <div className="flex flex-col gap-3">
        <InputControl
          control={control}
          name="name"
          data-testid="account-name"
          label="Name"
          rules={{ required: "Account name is required." }}
          autoCapitalize="words"
          enterKeyHint="next"
          className="w-full"
        />
        <SelectControl
          control={control}
          name="status"
          data-testid="account-status"
          label="Status"
          options={statusOptions}
          className="w-full"
        />
        <div className="grid grid-cols-2 gap-3">
          <SelectControl
            control={control}
            name="currencyCode"
            data-testid="account-currency"
            label="Currency"
            options={currencyOptions}
            disabled={isEditing}
            className="w-full"
          />
          <InputControl
            control={control}
            name="initialBalance"
            data-testid="account-initial-balance"
            label="Initial balance"
            type="text"
            inputMode="decimal"
            enterKeyHint="done"
            autoComplete="off"
            rules={{
              validate: (value) =>
                isMoneyInput(value, { allowNegative: true }) ||
                "Enter a balance with no more than two decimal places.",
            }}
            className="w-full"
          />
        </div>
        {account && (
          <p className="text-text-muted text-sm">
            Currency is fixed. Create another account to use a different currency.
          </p>
        )}
        {account && (
          <div className="flex flex-col gap-1">
            <label htmlFor="account-balance" className="text-text text-sm font-bold">
              Balance
            </label>
            <input
              id="account-balance"
              readOnly
              value={formatMoney(
                getProjectedBalance(account, initialBalance),
                account.currencyCode,
              )}
              aria-describedby="account-balance-description"
              className="border-border bg-surface-muted text-text-muted h-11 w-full rounded-lg border px-2 sm:h-9"
            />
            <p id="account-balance-description" className="text-text-muted text-sm">
              Initial balance plus all transactions
            </p>
          </div>
        )}
      </div>
      <div
        className={
          isEditing ? "flex items-center justify-between gap-2" : "flex justify-center gap-2"
        }
      >
        {account && (
          <Popover
            sheet
            aria-label="Remove account"
            renderTrigger={({ onOpen }) => (
              <Button
                data-testid="account-delete"
                variant="danger"
                type="button"
                disabled={isDeleting}
                onClick={onOpen}
              >
                <TrashIcon className="size-4" />
                Delete
              </Button>
            )}
          >
            <PopoverConfirm
              title="Remove account"
              message={`Delete account "${account.name}"? This also deletes all of its transactions. Linked transfers are deleted from both accounts.`}
              confirmLabel="Delete"
              confirmTestId="account-delete-confirm"
              confirmVariant="danger"
              onConfirm={handleDelete}
            />
          </Popover>
        )}
        <div className={isEditing ? "ml-auto flex gap-2" : "flex gap-2"}>
          <Button variant="secondary" type="button" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            disabled={formState.isSubmitting}
            data-testid="account-submit"
          >
            {isEditing ? "Save" : "Create"}
          </Button>
        </div>
      </div>
    </form>
  );
}
