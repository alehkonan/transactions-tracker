import { use } from "react";
import { Button } from "~/components/Button";
import { DialogContext } from "~/components/Dialog";

export function TransactionForm() {
  const { onClose } = use(DialogContext);

  return (
    <form>
      {/*TODO add inputs*/}
      <footer className="mt-2 flex justify-center gap-2">
        <Button className="min-w-20" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button className="min-w-20" type="submit" variant="primary">
          Save
        </Button>
      </footer>
    </form>
  );
}
