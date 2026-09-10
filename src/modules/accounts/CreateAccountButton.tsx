import { PlusIcon } from "lucide-react";
import { Button } from "~/components/Button";
import { Dialog } from "~/components/Dialog";
import { AccountForm } from "~/modules/accounts/AccountForm";

/** Opens the account creation dialog from the account list. */
export function CreateAccountButton() {
  return (
    <Dialog
      title="Add account"
      renderTrigger={({ onOpen }) => (
        <Button variant="secondary" onClick={onOpen}>
          <PlusIcon className="size-4" />
          Add account
        </Button>
      )}
    >
      <AccountForm />
    </Dialog>
  );
}
