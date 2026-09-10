import { ArrowDownIcon } from "lucide-react";
import { twJoin, twMerge } from "tailwind-merge";
import { Button } from "~/components/Button";
import { DateTimeControl } from "~/components/DateTimeControl";
import { InputControl } from "~/components/InputControl";
import { RadioGroupControl } from "~/components/RadioGroupControl";
import { SelectControl } from "~/components/SelectControl";
import { TextareaControl } from "~/components/TextareaControl";
import { necessityLevelEnum, transactionTypeEnum } from "~/database/enums";
import { DeleteTransactionButton } from "~/modules/transaction-form/DeleteTransactionButton";
import { useTransactionForm } from "~/modules/transaction-form/useTransactionForm";
import { necessityLevelStyles } from "~/modules/transactions/necessity-level";
import {
  transactionTypeIcons,
  transactionTypeStyles,
} from "~/modules/transactions/transaction-type-tag";
import { formatMoney } from "~/utils/format-money";
import { isMoneyInput } from "~/utils/money";
import type { AccountWithBalance } from "~/modules/accounts/compute-balances";
import type { CategoryRow } from "~/modules/categories/to-category-rows";
import type { TransactionRow } from "~/modules/transactions/to-transaction-rows";

type Props = {
  accounts: AccountWithBalance[];
  categories: CategoryRow[];
  /** When set, the form edits this existing row instead of creating a new one. */
  transaction?: TransactionRow;
};

const typeOrder = { EXPENSE: 0, INCOME: 1, TRANSFER: 2 } as const;
const typeOptions = transactionTypeEnum.enumValues
  .toSorted((left, right) => typeOrder[left] - typeOrder[right])
  .map((value) => ({
    value,
    label: value.charAt(0) + value.slice(1).toLowerCase(),
  }));

const necessityOptions = necessityLevelEnum.enumValues.map((value) => ({
  value,
  label: value.charAt(0) + value.slice(1).toLowerCase(),
}));

function validatePositiveAmount(value: string) {
  if (!value.trim()) return "Amount is required.";
  return (
    (isMoneyInput(value) && Number(value) > 0) ||
    "Enter a positive amount with no more than two decimal places."
  );
}

type BalancePreviewProps = {
  account: AccountWithBalance | undefined;
  projectedBalance: string | undefined;
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
      <RadioGroupControl
        control={control}
        name="type"
        label="Type"
        hideLabel
        options={typeOptions.map((option) => {
          const Icon = transactionTypeIcons[option.value];
          return {
            value: option.value,
            label: option.label,
            content: (
              <>
                <Icon className="size-4" />
                {option.label}
              </>
            ),
          };
        })}
        className="border-border bg-surface flex gap-1 rounded-lg border p-1"
        optionClassName={(option, checked) =>
          twMerge(
            "h-11 gap-1.5 rounded-md border border-transparent text-sm transition-colors md:h-9",
            checked
              ? transactionTypeStyles[option.value as keyof typeof transactionTypeStyles]
              : "text-text-muted hover:bg-surface-muted",
          )
        }
      />

      {type !== "TRANSFER" ? (
        <>
          {type === "EXPENSE" && (
            <RadioGroupControl
              control={control}
              name="necessityLevel"
              label="Necessity"
              options={necessityOptions}
              className="border-border bg-surface flex items-center gap-1 rounded-lg border p-1"
              optionClassName={(option, checked) =>
                twMerge(
                  "min-h-11 rounded-md border border-transparent text-sm capitalize transition-colors md:min-h-9",
                  checked
                    ? necessityLevelStyles[option.value as keyof typeof necessityLevelStyles]
                    : "text-text-muted hover:bg-surface-muted",
                )
              }
            />
          )}

          <DateTimeControl
            control={control}
            name="createdAt"
            label="Date & time"
            max={new Date()}
            rules={{
              validate: (value) =>
                value.getTime() <= Date.now() || "Date and time cannot be in the future.",
            }}
          />

          <SelectControl
            control={control}
            name="categoryId"
            label="Category"
            options={categoryOptions}
            placeholder="None"
            className="w-full"
          />
        </>
      ) : (
        <DateTimeControl
          control={control}
          name="createdAt"
          label="Date & time"
          max={new Date()}
          rules={{
            validate: (value) =>
              value.getTime() <= Date.now() || "Date and time cannot be in the future.",
          }}
        />
      )}

      {showTransferSplit ? (
        <div className="flex flex-col gap-1">
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <SelectControl
                  control={control}
                  name="accountId"
                  label="From account"
                  rules={{ required: "Account is required." }}
                  options={activeAccountOptions}
                  placeholder="Select account"
                  className="w-full"
                />
                <BalancePreview account={selectedAccount} projectedBalance={projectedBalance} />
              </div>
              <InputControl
                control={control}
                name="amount"
                label="Amount"
                rules={{ validate: validatePositiveAmount }}
                type="text"
                inputMode="decimal"
                enterKeyHint="next"
                autoComplete="off"
                className="w-full"
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
                  label="To account"
                  rules={{ required: "Account is required." }}
                  options={activeAccountOptions}
                  placeholder="Select account"
                  className="w-full"
                />
                <BalancePreview account={selectedToAccount} projectedBalance={projectedToBalance} />
              </div>
              <InputControl
                control={control}
                name="toAmount"
                label="Amount"
                rules={{ validate: validatePositiveAmount }}
                type="text"
                inputMode="decimal"
                enterKeyHint="next"
                autoComplete="off"
                className="w-full"
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
              className="w-full"
            />
            <BalancePreview account={selectedAccount} projectedBalance={projectedBalance} />
          </div>
          <InputControl
            control={control}
            name="amount"
            label="Amount"
            rules={{ validate: validatePositiveAmount }}
            type="text"
            inputMode="decimal"
            enterKeyHint="next"
            autoComplete="off"
            className="w-full"
          />
        </div>
      )}

      <TextareaControl
        control={control}
        name="comment"
        label="Comment"
        rows={2}
        enterKeyHint="done"
        className="w-full"
      />

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
