import { PlusIcon } from "lucide-react";
import { Button } from "~/components/Button";
import { Dialog } from "~/components/Dialog";
import { AccountForm } from "~/modules/accounts/AccountForm";

/** Icon button that opens a dialog to create a new account. */
export function CreateAccountButton() {
  return (
    <Dialog
      title="Add account"
      renderTrigger={({ onOpen }) => (
        <Button variant="primary" aria-label="Add account" onClick={onOpen}>
          <PlusIcon className="size-6" />
        </Button>
      )}
    >
      <AccountForm />
    </Dialog>
  );
}
