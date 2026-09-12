import { TrashIcon } from "lucide-react";
import { useContext, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { Button } from "~/components/Button";
import { DialogContext } from "~/components/Dialog";
import { InputControl } from "~/components/InputControl";
import { Popover } from "~/components/Popover";
import { PopoverConfirm } from "~/components/PopoverConfirm";
import { SelectControl } from "~/components/SelectControl";
import { accountStatusEnum, accountTypeEnum, currencyCodeEnum } from "~/database/enums";
import { createAccount, deleteAccount, updateAccount } from "~/modules/accounts/account-mutations";
import { readSelectedProfileId } from "~/modules/profile/profile-cookie";
import { useSyncStore } from "~/modules/sync/useSyncStore";
import { formatMoney } from "~/utils/format-money";
import { isMoneyInput } from "~/utils/money";
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
  if (!isMoneyInput(initialBalance, { allowNegative: true })) return account.balance;

  const transactionsCents =
    Math.round(Number(account.balance) * 100) - Math.round(Number(account.initialBalance) * 100);
  return ((Math.round(typed * 100) + transactionsCents) / 100).toFixed(2);
}

export function AccountForm({ account }: Props) {
  const { onClose } = useContext(DialogContext);
  const replicaContext = useSyncStore((state) => state.replicaContext);
  const isEditing = Boolean(account);
  const { control, handleSubmit, reset, formState } = useForm<AccountFormValues>({
    defaultValues: getDefaultValues(account),
  });
  const [isDeleting, startDeleteTransition] = useTransition();
  const initialBalance = useWatch({ control, name: "initialBalance" });

  const handleDelete = () => {
    if (!account || !replicaContext) return;
    startDeleteTransition(async () => {
      await deleteAccount(account, replicaContext);
      onClose();
    });
  };

  const onSubmit = handleSubmit(async (values) => {
    const profileId = readSelectedProfileId();
    if (profileId == null || !replicaContext) return;

    const input = {
      name: values.name,
      currencyCode: values.currencyCode as (typeof currencyCodeEnum.enumValues)[number],
      type: values.type as (typeof accountTypeEnum.enumValues)[number],
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
    onClose();
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 pt-3">
      <div className="flex flex-col gap-3">
        <InputControl
          control={control}
          name="name"
          label="Name"
          rules={{ required: "Account name is required." }}
          autoCapitalize="words"
          enterKeyHint="next"
          className="w-full"
        />
        <div className="grid grid-cols-2 gap-3">
          <SelectControl
            control={control}
            name="type"
            label="Type"
            options={typeOptions}
            className="w-full"
          />
          <SelectControl
            control={control}
            name="status"
            label="Status"
            options={statusOptions}
            className="w-full"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <SelectControl
            control={control}
            name="currencyCode"
            label="Currency"
            options={currencyOptions}
            className="w-full"
          />
          <InputControl
            control={control}
            name="initialBalance"
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
            aria-label="Remove account"
            renderTrigger={({ onOpen }) => (
              <Button variant="danger" type="button" disabled={isDeleting} onClick={onOpen}>
                <TrashIcon className="size-4" />
                Delete
              </Button>
            )}
          >
            <PopoverConfirm
              title="Remove account"
              message={`Delete account "${account.name}"? This also deletes all of its transactions.`}
              confirmLabel="Delete"
              confirmVariant="danger"
              onConfirm={handleDelete}
            />
          </Popover>
        )}
        <div className={isEditing ? "ml-auto flex gap-2" : "flex gap-2"}>
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={formState.isSubmitting}>
            {isEditing ? "Save" : "Create"}
          </Button>
        </div>
      </div>
    </form>
  );
}
