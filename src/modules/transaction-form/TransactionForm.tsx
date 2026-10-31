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
    isLinkedTransfer,
    selectedAccount,
    selectedToAccount,
    projectedBalance,
    projectedToBalance,
    markToAmountTouched,
    onSubmit,
    onCancel,
    isEditing,
    isPending,
    rootError,
    sphereOptions,
    sphereWarnings,
    balancesComplete,
    attributionReady,
    counterpartId,
    setCounterpartId,
    counterpartOptions,
    linkCounterpart,
    isLinking,
  } = useTransactionForm({ accounts, transaction });
  const { control } = form;

  const activeAccountOptions = accounts
    .filter(
      (account) =>
        account.status === "ACTIVE" ||
        (isEditing &&
          (account.id === form.getValues("accountId") ||
            account.id === form.getValues("toAccountId"))),
    )
    .map((account) => ({
      value: account.id,
      label: `${account.name} (${account.currencyCode})`,
    }));

  const categoryOptions = categories.map((category) => ({
    value: category.id,
    label: category.name,
  }));

  return (
    <form onSubmit={onSubmit} data-testid="transaction-form" className="flex flex-col gap-3 pt-2">
      <RadioGroupControl
        control={control}
        name="type"
        label="Type"
        hideLabel
        options={typeOptions
          .filter((option) =>
            isLinkedTransfer
              ? option.value === "TRANSFER"
              : !isEditing || transaction?.type === "TRANSFER" || option.value !== "TRANSFER",
          )
          .map((option) => {
            const Icon = transactionTypeIcons[option.value];
            return {
              value: option.value,
              testId: `transaction-type-${option.value}`,
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
          <p className="text-text-muted text-sm">
            Both sides are saved and deleted together. Same-currency amounts must match; enter fees
            as separate Expense transactions.
          </p>
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <SelectControl
                  control={control}
                  name="accountId"
                  data-testid="transaction-account"
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
                data-testid="transaction-amount"
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
                  data-testid="transaction-to-account"
                  label="To account"
                  rules={{
                    required: "Account is required.",
                    validate: (value) =>
                      value !== form.getValues("accountId") ||
                      "Choose a different destination account.",
                  }}
                  options={activeAccountOptions}
                  placeholder="Select account"
                  className="w-full"
                />
                <BalancePreview account={selectedToAccount} projectedBalance={projectedToBalance} />
              </div>
              <InputControl
                control={control}
                name="toAmount"
                data-testid="transaction-to-amount"
                label="Amount"
                rules={{
                  validate: (value) => {
                    const positive = validatePositiveAmount(value);
                    if (positive !== true) return positive;
                    return (
                      !selectedAccount ||
                      selectedAccount.currencyCode !== selectedToAccount?.currencyCode ||
                      Number(value) === Number(form.getValues("amount")) ||
                      "Amounts must match. Enter fees as a separate Expense."
                    );
                  },
                }}
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
              data-testid="transaction-account"
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
            data-testid="transaction-amount"
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

      <div className={showTransferSplit ? "grid gap-3 sm:grid-cols-2" : "flex flex-col"}>
        {(showTransferSplit ? (["sphereId", "toSphereId"] as const) : (["sphereId"] as const)).map(
          (name) => (
            <label key={name} className="flex min-w-0 flex-col gap-1 text-sm">
              {showTransferSplit ? (name === "sphereId" ? "From sphere" : "To sphere") : "Sphere"}
              <select
                {...form.register(name)}
                data-testid={name === "sphereId" ? "transaction-sphere" : "transaction-to-sphere"}
                className="border-border bg-surface text-text focus-visible:ring-accent h-11 w-full min-w-0 rounded-2xl border px-3 focus-visible:ring-2 focus-visible:outline-none sm:h-9"
              >
                {sphereOptions.map((option) => (
                  <option
                    key={option.value}
                    value={option.value}
                    disabled={"disabled" in option && option.disabled}
                  >
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ),
        )}
      </div>
      <div aria-live="polite">
        {!balancesComplete && (
          <p className="text-text-muted text-sm">
            Sphere balances are still loading. Negative-balance warnings are incomplete.
          </p>
        )}
        {!attributionReady && (
          <p className="text-warning text-sm">
            Finish loading this transaction's sphere before editing.
          </p>
        )}
        {sphereWarnings.map((warning) => (
          <p
            key={`${warning.label}:${warning.currencyCode}`}
            className="text-warning text-sm"
            data-testid="transaction-sphere-warning"
          >
            {warning.label} will have {formatMoney(warning.balance, warning.currencyCode)} after
            saving. You can continue with a negative sphere balance.
          </p>
        ))}
      </div>

      <TextareaControl
        control={control}
        name="comment"
        data-testid="transaction-comment"
        label="Comment"
        rows={2}
        enterKeyHint="done"
        className="w-full"
      />

      {transaction?.type === "TRANSFER" && !isLinkedTransfer && (
        <fieldset
          className="border-border flex min-w-0 flex-col gap-2 border-t pt-3"
          disabled={isPending || isLinking}
        >
          <legend className="text-sm font-semibold">Link an existing transfer</legend>
          <p className="text-text-muted text-sm">
            Choose the other saved record yourself. Linking preserves both records' amounts, dates,
            categories, and spheres. After linking, edits and deletion affect both sides.
          </p>
          <label className="flex flex-col gap-1 text-sm">
            Counterpart Transfer
            <select
              data-testid="transfer-counterpart"
              value={counterpartId}
              onChange={(event) => setCounterpartId(event.target.value)}
              className="border-border bg-surface text-text focus-visible:ring-accent h-11 w-full min-w-0 rounded-2xl border px-3 text-base focus-visible:ring-2 focus-visible:outline-none sm:h-9 sm:text-sm"
            >
              <option value="">Select a saved Transfer</option>
              {counterpartOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {counterpartOptions.length === 0 && (
            <p className="text-text-muted text-sm">
              No other unpaired Transfer records in this profile.
            </p>
          )}
          {form.formState.isDirty && (
            <p className="text-warning text-sm">
              Save or discard your edits before linking the saved records.
            </p>
          )}
          <Button
            type="button"
            variant="secondary"
            data-testid="transfer-link"
            onClick={linkCounterpart}
            disabled={
              !counterpartId ||
              isPending ||
              isLinking ||
              !balancesComplete ||
              form.formState.isDirty
            }
          >
            {isLinking ? "Linking…" : "Link saved records"}
          </Button>
        </fieldset>
      )}

      {rootError && (
        <p data-testid="transaction-error" className="text-danger text-sm" aria-live="polite">
          {rootError}
        </p>
      )}

      <footer
        className={twJoin("mt-2 flex gap-2", isEditing ? "justify-between" : "justify-center")}
      >
        {isEditing && transaction && <DeleteTransactionButton id={transaction.id} />}
        <div className="flex gap-2">
          <Button
            data-testid="transaction-cancel"
            className="min-w-20"
            variant="secondary"
            type="button"
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            data-testid="transaction-submit"
            className="min-w-20"
            type="submit"
            variant="primary"
            disabled={isPending || isLinking || !attributionReady}
          >
            {isEditing ? (isPending ? "Updating…" : "Update") : isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </footer>
    </form>
  );
}
