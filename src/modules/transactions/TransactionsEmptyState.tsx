import { ListFilterIcon, PlusIcon, ReceiptTextIcon, SearchIcon, WalletIcon } from "lucide-react";
import { Button } from "~/components/Button";
import { Dialog } from "~/components/Dialog";
import { AccountForm } from "~/modules/accounts/AccountForm";

type Props =
  | { kind: "no-accounts" }
  | { kind: "no-transactions"; onAddTransaction: () => void }
  | { kind: "search"; query: string; onClearSearch: () => void }
  | { kind: "filters"; onClearFilters: () => void };

export function TransactionsEmptyState(props: Props) {
  const content =
    props.kind === "no-accounts"
      ? {
          icon: WalletIcon,
          title: "Create an account first",
          description:
            "Transactions need an active account so every entry has a balance to update.",
        }
      : props.kind === "no-transactions"
        ? {
            icon: ReceiptTextIcon,
            title: "No transactions yet",
            description: "Add your first income, expense, or transfer to start the ledger.",
          }
        : props.kind === "search"
          ? {
              icon: SearchIcon,
              title: "No matching transactions",
              description: `Nothing matches “${props.query}”. Try another term or clear the search.`,
            }
          : {
              icon: ListFilterIcon,
              title: "No transactions match these filters",
              description: "Remove a filter or clear them all to bring the full ledger back.",
            };

  const Icon = content.icon;

  return (
    <section
      aria-labelledby="transactions-empty-heading"
      className="border-border bg-surface flex min-h-56 flex-col items-center justify-center rounded-xl border px-5 py-8 text-center"
    >
      <span className="bg-accent-muted text-accent mb-4 grid size-11 place-items-center rounded-2xl">
        <Icon className="size-5" />
      </span>
      <h2 id="transactions-empty-heading" className="text-text text-lg font-semibold">
        {content.title}
      </h2>
      <p className="text-text-muted mt-2 max-w-md text-sm">{content.description}</p>

      <div className="mt-5">
        {props.kind === "no-accounts" ? (
          <Dialog
            title="Add account"
            renderTrigger={({ onOpen }) => (
              <Button variant="primary" onClick={onOpen}>
                <PlusIcon className="size-4" />
                Add account
              </Button>
            )}
          >
            <AccountForm />
          </Dialog>
        ) : props.kind === "no-transactions" ? (
          <Button variant="primary" onClick={props.onAddTransaction}>
            <PlusIcon className="size-4" />
            Add transaction
          </Button>
        ) : props.kind === "search" ? (
          <Button variant="secondary" onClick={props.onClearSearch}>
            Clear search
          </Button>
        ) : (
          <Button variant="secondary" onClick={props.onClearFilters}>
            Clear all filters
          </Button>
        )}
      </div>
    </section>
  );
}
