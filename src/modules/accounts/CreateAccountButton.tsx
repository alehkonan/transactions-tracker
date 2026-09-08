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
          className="border-border bg-surface-muted hover:bg-surface-hover focus-visible:ring-accent flex min-h-24 w-full cursor-pointer items-center gap-3 rounded-2xl border border-dashed p-3 text-left transition-[background-color,transform] duration-200 hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none motion-reduce:transform-none motion-reduce:transition-none"
        >
          <span className="bg-accent text-surface flex size-11 shrink-0 items-center justify-center rounded-2xl">
            <PlusIcon className="size-6" />
          </span>
          <span className="flex flex-col gap-1">
            <span className="text-sm font-bold">Add account</span>
            <span className="text-text-muted text-xs">Current or savings</span>
          </span>
        </button>
      )}
    >
      <AccountForm />
    </Dialog>
  );
}
