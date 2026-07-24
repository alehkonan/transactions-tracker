import { UploadIcon } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "~/components/Button";
import { Dialog } from "~/components/Dialog";
import { FileInput } from "~/components/FileInput";
import { Title } from "~/components/Title";

export function TransactionsImportButton() {
  const [file, setFile] = useState<File | null>(null);
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
        <div className="mt-4">
          <FileInput file={file} onFileChange={setFile} accept="text/csv" />
        </div>
        <footer className="mt-2 flex justify-center gap-2">
          <Button variant="secondary" onClick={() => dialogRef.current?.close()}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!file}>
            Upload
          </Button>
        </footer>
      </Dialog>
    </>
  );
}
