import { PlusIcon } from "lucide-react";
import { Dialog } from "~/components/Dialog";
import { AccountForm } from "~/modules/accounts/AccountForm";

/** A card-shaped action at the end of the account list that opens the creation dialog. */
export function CreateAccountButton() {
  return (
    <Dialog
      title="Add account"
      renderTrigger={({ onOpen }) => (
        <button
          type="button"
          onClick={onOpen}
          className="border-border bg-surface-muted hover:bg-surface-hover focus-visible:ring-accent flex min-h-20 w-full items-center gap-3 rounded-2xl border border-dashed p-3 text-left shadow-sm transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          <span className="bg-accent text-surface flex size-11 shrink-0 items-center justify-center rounded-2xl">
            <PlusIcon className="size-6" />
          </span>
          <span className="flex flex-col gap-1">
            <span className="text-sm font-bold">
              Create a <span className="text-accent">new</span> account
            </span>
            <span className="text-text-muted text-xs">Add a current or savings account</span>
          </span>
        </button>
      )}
    >
      <AccountForm />
    </Dialog>
  );
}
