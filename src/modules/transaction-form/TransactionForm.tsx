import { Field } from "@base-ui/react/field";
import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { ArrowDownIcon } from "lucide-react";
import { Controller } from "react-hook-form";
import { twMerge } from "tailwind-merge";
import { Button } from "~/components/Button";
import { Select } from "~/components/Select";
import { necessityLevelEnum, transactionTypeEnum } from "~/database/enums";
import { useTransactionForm } from "~/modules/transaction-form/useTransactionForm";
import { necessityLevelStyles } from "~/modules/transactions/NecessityLevelTag";
import { formatMoney } from "~/utils/formatMoney";
import type { getAccounts } from "~/api/account.functions";
import type { getCategories } from "~/api/category.functions";
import type { TransactionRow } from "~/api/transaction.functions";

type Account = Awaited<ReturnType<typeof getAccounts>>[number];
type Category = Awaited<ReturnType<typeof getCategories>>[number];

type Props = {
  accounts: Account[];
  categories: Category[];
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
  account: Account | undefined;
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

function FieldErrorText({ message }: { message: string | undefined }) {
  if (!message) return null;
  return <p className="text-danger text-sm">{message}</p>;
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
  const { control, register, formState } = form;

  const activeAccountOptions = accounts
    .filter((account) => account.status === "ACTIVE")
    .map((account) => ({
      value: String(account.id),
      label: `${account.name} (${account.currencyCode})`,
    }));

  const categoryOptions = categories.map((category) => ({
    value: String(category.id),
    label: category.name,
  }));

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 pt-2">
      <Field.Root className="flex flex-col gap-1">
        <Controller
          control={control}
          name="type"
          render={({ field }) => (
            <ToggleGroup
              aria-label="Type"
              value={[field.value]}
              onValueChange={([value]) => value && field.onChange(value)}
              className="border-border bg-surface flex gap-1 rounded-lg border p-1"
            >
              {typeOptions.map((option) => (
                <Toggle
                  key={option.value}
                  value={option.value}
                  className="text-text data-[pressed]:bg-accent data-[pressed]:text-surface not-data-[pressed]:hover:bg-surface-muted h-9 flex-1 rounded-md px-3 text-sm transition-colors"
                >
                  {option.label}
                </Toggle>
              ))}
            </ToggleGroup>
          )}
        />
      </Field.Root>

      {type !== "TRANSFER" && (
        <div className="grid grid-cols-2 gap-3">
          <Field.Root className="flex flex-col gap-1">
            <Field.Label className="text-text text-sm font-bold">Category</Field.Label>
            <Controller
              control={control}
              name="categoryId"
              render={({ field }) => (
                <Select
                  name="categoryId"
                  value={field.value}
                  onValueChange={(value) => field.onChange(value ?? "")}
                  options={categoryOptions}
                  placeholder="None"
                />
              )}
            />
          </Field.Root>

          <Field.Root className="flex flex-col gap-1">
            <Field.Label className="text-text text-sm font-bold">Necessity</Field.Label>
            <Controller
              control={control}
              name="necessityLevel"
              render={({ field }) => (
                <ToggleGroup
                  aria-label="Necessity"
                  value={field.value ? [field.value] : []}
                  onValueChange={([value]) => field.onChange(value ?? "")}
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
                </ToggleGroup>
              )}
            />
          </Field.Root>
        </div>
      )}

      {showTransferSplit ? (
        <div className="flex flex-col gap-1">
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field.Root className="flex flex-col gap-1">
                <Field.Label className="text-text text-sm font-bold">Account</Field.Label>
                <Controller
                  control={control}
                  name="accountId"
                  rules={{ required: "Account is required." }}
                  render={({ field, fieldState }) => (
                    <>
                      <Select
                        name="accountId"
                        value={field.value}
                        onValueChange={(value) => field.onChange(value ?? "")}
                        options={activeAccountOptions}
                        placeholder="Select account"
                      />
                      <FieldErrorText message={fieldState.error?.message} />
                    </>
                  )}
                />
                <BalancePreview account={selectedAccount} projectedBalance={projectedBalance} />
              </Field.Root>
              <Field.Root className="flex flex-col gap-1">
                <Field.Label className="text-text text-sm font-bold">Amount</Field.Label>
                <Field.Control
                  className="border-border bg-surface text-text h-9 rounded-lg border px-2"
                  type="number"
                  step="0.01"
                  min="0.01"
                  {...register("amount", { required: "Amount is required." })}
                />
                <FieldErrorText message={formState.errors.amount?.message} />
              </Field.Root>
            </div>
          </div>

          <ArrowDownIcon className="text-text-muted mx-auto size-5" />

          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field.Root className="flex flex-col gap-1">
                <Field.Label className="text-text text-sm font-bold">Account</Field.Label>
                <Controller
                  control={control}
                  name="toAccountId"
                  rules={{ required: "Account is required." }}
                  render={({ field, fieldState }) => (
                    <>
                      <Select
                        name="toAccountId"
                        value={field.value}
                        onValueChange={(value) => field.onChange(value ?? "")}
                        options={activeAccountOptions}
                        placeholder="Select account"
                      />
                      <FieldErrorText message={fieldState.error?.message} />
                    </>
                  )}
                />
                <BalancePreview account={selectedToAccount} projectedBalance={projectedToBalance} />
              </Field.Root>
              <Field.Root className="flex flex-col gap-1">
                <Field.Label className="text-text text-sm font-bold">Amount</Field.Label>
                <Field.Control
                  className="border-border bg-surface text-text h-9 rounded-lg border px-2"
                  type="number"
                  step="0.01"
                  min="0.01"
                  {...register("toAmount", {
                    required: "Amount is required.",
                    onChange: markToAmountTouched,
                  })}
                />
                <FieldErrorText message={formState.errors.toAmount?.message} />
              </Field.Root>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Field.Root className="flex flex-col gap-1">
            <Field.Label className="text-text text-sm font-bold">Account</Field.Label>
            <Controller
              control={control}
              name="accountId"
              rules={{ required: "Account is required." }}
              render={({ field, fieldState }) => (
                <>
                  <Select
                    name="accountId"
                    value={field.value}
                    onValueChange={(value) => field.onChange(value ?? "")}
                    options={activeAccountOptions}
                    placeholder="Select account"
                  />
                  <FieldErrorText message={fieldState.error?.message} />
                </>
              )}
            />
            <BalancePreview account={selectedAccount} projectedBalance={projectedBalance} />
          </Field.Root>
          <Field.Root className="flex flex-col gap-1">
            <Field.Label className="text-text text-sm font-bold">Amount</Field.Label>
            <Field.Control
              className="border-border bg-surface text-text h-9 rounded-lg border px-2"
              type="number"
              step="0.01"
              min="0.01"
              {...register("amount", { required: "Amount is required." })}
            />
            <FieldErrorText message={formState.errors.amount?.message} />
          </Field.Root>
        </div>
      )}

      <Field.Root className="flex flex-col gap-1">
        <Field.Label className="text-text text-sm font-bold">Comment</Field.Label>
        <Field.Control
          render={
            <textarea
              rows={3}
              className="border-border bg-surface text-text resize-none rounded-lg border px-2 py-2"
            />
          }
          {...register("comment")}
        />
      </Field.Root>

      <FieldErrorText message={rootError} />

      <footer className="mt-2 flex justify-center gap-2">
        <Button className="min-w-20" variant="secondary" type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button className="min-w-20" type="submit" variant="primary" disabled={isPending}>
          {isEditing ? (isPending ? "Updating…" : "Update") : isPending ? "Saving…" : "Save"}
        </Button>
      </footer>
    </form>
  );
}
