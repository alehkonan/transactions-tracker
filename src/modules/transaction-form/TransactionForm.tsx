import { Toggle } from "@base-ui/react/toggle";
import { ArrowDownIcon } from "lucide-react";
import { twJoin, twMerge } from "tailwind-merge";
import { Button } from "~/components/Button";
import { InputControl } from "~/components/InputControl";
import { SelectControl } from "~/components/SelectControl";
import { TextareaControl } from "~/components/TextareaControl";
import { ToggleGroupControl } from "~/components/ToggleGroupControl";
import { necessityLevelEnum, transactionTypeEnum } from "~/database/enums";
import { DeleteTransactionButton } from "~/modules/transaction-form/DeleteTransactionButton";
import { useTransactionForm } from "~/modules/transaction-form/useTransactionForm";
import { necessityLevelStyles } from "~/modules/transactions/NecessityLevelTag";
import {
  transactionTypeIcons,
  transactionTypeStyles,
} from "~/modules/transactions/TransactionTypeTag";
import { formatMoney } from "~/utils/format-money";
import type { AccountWithBalance } from "~/modules/accounts/compute-balances";
import type { CategoryRow } from "~/modules/categories/to-category-rows";
import type { TransactionRow } from "~/modules/transactions/to-transaction-rows";

type Props = {
  accounts: AccountWithBalance[];
  categories: CategoryRow[];
  /** When set, the form edits this existing row instead of creating a new one. */
  transaction?: TransactionRow;
};

const typeOptions = transactionTypeEnum.enumValues.map((value) => ({
  value,
  label: value.charAt(0) + value.slice(1).toLowerCase(),
}));

const necessityOptions = necessityLevelEnum.enumValues.map((value) => ({
  value,
  label: value.charAt(0) + value.slice(1).toLowerCase(),
}));

type BalancePreviewProps = {
  account: AccountWithBalance | undefined;
  projectedBalance: number | undefined;
};

/** Shows the selected account's current balance, and what it'll become once the typed amount is applied. */
function BalancePreview({ account, projectedBalance }: BalancePreviewProps) {
  if (!account) return null;
  return (
    <p className="text-text-muted text-xs">
      Balance: {formatMoney(account.balance, account.currencyCode)}
      {projectedBalance !== undefined && (
        <>
          {" → "}
          <span className="text-text font-medium">
            {formatMoney(String(projectedBalance), account.currencyCode)}
          </span>
        </>
      )}
    </p>
  );
}

export function TransactionForm({ accounts, categories, transaction }: Props) {
  const {
    form,
    type,
    showTransferSplit,
    selectedAccount,
    selectedToAccount,
    projectedBalance,
    projectedToBalance,
    markToAmountTouched,
    onSubmit,
    onClose,
    isEditing,
    isPending,
    rootError,
  } = useTransactionForm({ accounts, transaction });
  const { control } = form;

  const activeAccountOptions = accounts
    .filter((account) => account.status === "ACTIVE")
    .map((account) => ({
      value: account.id,
      label: `${account.name} (${account.currencyCode})`,
    }));

  const categoryOptions = categories.map((category) => ({
    value: category.id,
    label: category.name,
  }));

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 pt-2">
      <ToggleGroupControl
        control={control}
        name="type"
        aria-label="Type"
        className="border-border bg-surface flex gap-1 rounded-lg border p-1"
      >
        {typeOptions.map((option) => {
          const Icon = transactionTypeIcons[option.value];
          return (
            <Toggle
              key={option.value}
              value={option.value}
              className={(toggleState) =>
                twMerge(
                  "flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent text-sm transition-colors",
                  toggleState.pressed
                    ? transactionTypeStyles[option.value]
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

      {type !== "TRANSFER" && (
        <div className="grid grid-cols-2 gap-3">
          <SelectControl
            control={control}
            name="categoryId"
            label="Category"
            options={categoryOptions}
            placeholder="None"
          />

          <ToggleGroupControl
            control={control}
            name="necessityLevel"
            label="Necessity"
            aria-label="Necessity"
            className="border-border bg-surface flex h-9 items-center gap-1 rounded-lg border p-1"
          >
            {necessityOptions.map((option) => (
              <Toggle
                key={option.value}
                value={option.value}
                className={(toggleState) =>
                  twMerge(
                    "h-full flex-1 rounded-md border border-transparent text-sm capitalize transition-colors",
                    toggleState.pressed
                      ? necessityLevelStyles[option.value]
                      : "text-text-muted hover:bg-surface-muted",
                  )
                }
              >
                {option.label}
              </Toggle>
            ))}
          </ToggleGroupControl>
        </div>
      )}

      {showTransferSplit ? (
        <div className="flex flex-col gap-1">
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <SelectControl
                  control={control}
                  name="accountId"
                  label="Account"
                  rules={{ required: "Account is required." }}
                  options={activeAccountOptions}
                  placeholder="Select account"
                />
                <BalancePreview account={selectedAccount} projectedBalance={projectedBalance} />
              </div>
              <InputControl
                control={control}
                name="amount"
                label="Amount"
                rules={{ required: "Amount is required." }}
                type="number"
                step="0.01"
                min="0.01"
              />
            </div>
          </div>

          <ArrowDownIcon className="text-text-muted mx-auto size-5" />

          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <SelectControl
                  control={control}
                  name="toAccountId"
                  label="Account"
                  rules={{ required: "Account is required." }}
                  options={activeAccountOptions}
                  placeholder="Select account"
                />
                <BalancePreview account={selectedToAccount} projectedBalance={projectedToBalance} />
              </div>
              <InputControl
                control={control}
                name="toAmount"
                label="Amount"
                rules={{ required: "Amount is required." }}
                type="number"
                step="0.01"
                min="0.01"
                onChange={markToAmountTouched}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <SelectControl
              control={control}
              name="accountId"
              label="Account"
              rules={{ required: "Account is required." }}
              options={activeAccountOptions}
              placeholder="Select account"
            />
            <BalancePreview account={selectedAccount} projectedBalance={projectedBalance} />
          </div>
          <InputControl
            control={control}
            name="amount"
            label="Amount"
            rules={{ required: "Amount is required." }}
            type="number"
            step="0.01"
            min="0.01"
          />
        </div>
      )}

      <TextareaControl control={control} name="comment" label="Comment" rows={3} />

      {rootError && <p className="text-danger text-sm">{rootError}</p>}

      <footer
        className={twJoin("mt-2 flex gap-2", isEditing ? "justify-between" : "justify-center")}
      >
        {isEditing && transaction && <DeleteTransactionButton id={transaction.id} />}
        <div className="flex gap-2">
          <Button className="min-w-20" variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button className="min-w-20" type="submit" variant="primary" disabled={isPending}>
            {isEditing ? (isPending ? "Updating…" : "Update") : isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </footer>
    </form>
  );
}
