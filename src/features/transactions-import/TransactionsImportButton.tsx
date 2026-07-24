import { UploadIcon } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "~/components/Button";
import { Dialog } from "~/components/Dialog";
import { Title } from "~/components/Title";

export function TransactionsImportButton() {
  const [files, setFiles] = useState<FileList | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <Button
        variant="secondary"
        onClick={() => {
          dialogRef.current?.showModal();
        }}
      >
        <UploadIcon />
        <span className="hidden sm:block">Import CSV</span>
      </Button>
      <Dialog ref={dialogRef}>
        <Title variant="card">Import CSV</Title>
        <input
          type="file"
          className="mt-4"
          onChange={(e) => {
            setFiles(e.target.files);
          }}
        />
        <footer className="mt-2 flex justify-center gap-2">
          <Button variant="secondary" onClick={() => dialogRef.current?.close()}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!files}>
            Upload
          </Button>
        </footer>
      </Dialog>
    </>
  );
}
