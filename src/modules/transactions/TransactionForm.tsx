import { useRouter } from "@tanstack/react-router";
import { use, useActionState, useId, useRef, useState, type ComponentProps } from "react";
import { createTransactions } from "~/api/transaction.functions";
import { Button } from "~/components/Button";
import { DialogContext } from "~/components/Dialog";
import { Select } from "~/components/Select";
import { necessityLevelEnum, transactionTypeEnum } from "~/database/enums";
import type { getAccounts } from "~/api/account.functions";
import type { getCategories } from "~/api/category.functions";

type Account = Awaited<ReturnType<typeof getAccounts>>[number];
type Category = Awaited<ReturnType<typeof getCategories>>[number];
type NecessityLevel = (typeof necessityLevelEnum.enumValues)[number];
type TransactionType = (typeof transactionTypeEnum.enumValues)[number];

type CreateTransactionInput = {
  createdAt?: string;
  categoryId?: number;
  necessityLevel?: NecessityLevel;
  type: TransactionType;
  accountId?: number;
  amount: string;
  comment?: string;
};

type Props = {
  accounts: Account[];
  categories: Category[];
};

type FormState = { error: string } | null;

const pad = (n: number) => String(n).padStart(2, "0");

/** Formats a Date for an `<input type="datetime-local">` value, in local time. */
function toDatetimeLocalValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Outgoing amounts (expenses, and the source leg of a transfer) are stored negative; users type a positive number and this flips its sign. */
function negateIfPositive(amount: string): string {
  const trimmed = amount.trim();
  return trimmed.startsWith("-") ? trimmed : `-${trimmed}`;
}

function TextField({ label, ...props }: { label: string } & ComponentProps<"input">) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-text text-sm font-bold">
        {label}
      </label>
      <input
        id={id}
        className="border-border bg-surface text-text h-9 rounded-lg border px-2"
        {...props}
      />
    </div>
  );
}

const typeOptions = transactionTypeEnum.enumValues.map((value) => ({
  value,
  label: value.charAt(0) + value.slice(1).toLowerCase(),
}));

const necessityOptions = necessityLevelEnum.enumValues.map((value) => ({
  value,
  label: value.charAt(0) + value.slice(1).toLowerCase(),
}));

export function TransactionForm({ accounts, categories }: Props) {
  const { onClose } = use(DialogContext);
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [type, setType] = useState<TransactionType>("EXPENSE");
  const [initialCreatedAt] = useState(() => toDatetimeLocalValue(new Date()));

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

  const [state, formAction, isPending] = useActionState<FormState, FormData>(
    async (_previousState, formData) => {
      const formType = formData.get("type") as TransactionType;
      const createdAt = formData.get("createdAt") as string;
      const categoryId = formData.get("categoryId") as string;
      const necessityLevel = formData.get("necessityLevel") as string;
      const comment = formData.get("comment") as string;

      const shared = {
        createdAt: createdAt ? new Date(createdAt).toISOString() : undefined,
        categoryId: categoryId ? Number(categoryId) : undefined,
        necessityLevel: necessityLevel ? (necessityLevel as NecessityLevel) : undefined,
        comment: comment || undefined,
      };

      // A transfer moves money between two of the user's own accounts, so it's
      // recorded as two TRANSFER-typed rows (one per account) rather than
      // EXPENSE+INCOME, keeping it out of spending/income statistics.
      const inputs: CreateTransactionInput[] =
        formType === "TRANSFER"
          ? [
              {
                ...shared,
                type: "TRANSFER",
                accountId: Number(formData.get("accountId")),
                amount: negateIfPositive(formData.get("amount") as string),
              },
              {
                ...shared,
                type: "TRANSFER",
                accountId: Number(formData.get("toAccountId")),
                amount: formData.get("toAmount") as string,
              },
            ]
          : [
              {
                ...shared,
                type: formType,
                accountId: Number(formData.get("accountId")),
                amount:
                  formType === "EXPENSE"
                    ? negateIfPositive(formData.get("amount") as string)
                    : (formData.get("amount") as string),
              },
            ];

      try {
        await createTransactions({ data: inputs });
      } catch {
        return { error: "Failed to save transaction. Please try again." };
      }

      await router.invalidate();
      formRef.current?.reset();
      setType("EXPENSE");
      onClose();
      return null;
    },
    null,
  );

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-3 pt-2">
      <Select
        label="Type"
        name="type"
        value={type}
        onChange={(event) => setType(event.target.value as TransactionType)}
        options={typeOptions}
      />

      {type === "TRANSFER" ? (
        <div className="grid grid-cols-2 gap-3">
          <Select
            label="From account"
            name="accountId"
            defaultValue=""
            options={activeAccountOptions}
            placeholder="Select account"
            placeholderDisabled
            required
          />
          <TextField label="Amount" name="amount" type="number" step="0.01" min="0.01" required />
          <Select
            label="To account"
            name="toAccountId"
            defaultValue=""
            options={activeAccountOptions}
            placeholder="Select account"
            placeholderDisabled
            required
          />
          <TextField label="Amount" name="toAmount" type="number" step="0.01" min="0.01" required />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Account"
            name="accountId"
            defaultValue=""
            options={activeAccountOptions}
            placeholder="Select account"
            placeholderDisabled
            required
          />
          <TextField label="Amount" name="amount" type="number" step="0.01" min="0.01" required />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Select
          label="Category"
          name="categoryId"
          defaultValue=""
          options={categoryOptions}
          placeholder="None"
        />
        <Select
          label="Necessity"
          name="necessityLevel"
          defaultValue=""
          options={necessityOptions}
          placeholder="Default (Medium)"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <TextField
          label="Date & time"
          name="createdAt"
          type="datetime-local"
          defaultValue={initialCreatedAt}
        />
        <TextField label="Comment" name="comment" type="text" />
      </div>

      {state?.error && <p className="text-danger text-sm">{state.error}</p>}

      <footer className="mt-2 flex justify-center gap-2">
        <Button className="min-w-20" variant="secondary" type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button className="min-w-20" type="submit" variant="primary" disabled={isPending}>
          {isPending ? "Saving…" : "Save"}
        </Button>
      </footer>
    </form>
  );
}
