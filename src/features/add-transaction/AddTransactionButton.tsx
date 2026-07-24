import { PlusIcon } from "lucide-react";
import { useRef } from "react";
import { Button } from "~/components/Button";
import { Dialog } from "~/components/Dialog";
import { Title } from "~/components/Title";

export function AddTransactionButton() {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <Button variant="primary" onClick={() => dialogRef.current?.showModal()}>
        <PlusIcon />
        <span className="hidden sm:block">Add transaction</span>
      </Button>
      <Dialog ref={dialogRef}>
        <Title variant="card">Add transaction</Title>
        <p>Transaction Form</p>
        <footer className="mt-2 flex justify-center gap-2">
          <Button variant="secondary" onClick={() => dialogRef.current?.close()}>
            Cancel
          </Button>
          <Button variant="primary">Save</Button>
        </footer>
      </Dialog>
    </>
  );
}
