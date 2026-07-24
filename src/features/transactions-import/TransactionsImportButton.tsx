import { UploadIcon } from "lucide-react";
import { useRef } from "react";
import { Button } from "~/components/Button";
import { Dialog } from "~/components/Dialog";
import { FileInput } from "~/components/FileInput";
import { Title } from "~/components/Title";
import { CsvMapper } from "./CsvMapper";
import { CsvPreview } from "./CsvPreview";
import { useCsvImport } from "./useCsvImport";

export function TransactionsImportButton() {
  const { file, csv, mapping, canUpload, selectFile, setMapping, reset } = useCsvImport();
  const dialogRef = useRef<HTMLDialogElement>(null);

  const handleCancel = () => {
    reset();
    dialogRef.current?.close();
  };

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
          <FileInput file={file} onFileChange={selectFile} accept="text/csv" />
        </div>
        {csv && (
          <div className="mt-4 flex flex-col gap-4">
            <CsvPreview csv={csv} />
            <CsvMapper headers={csv.headers} mapping={mapping} onMappingChange={setMapping} />
          </div>
        )}
        <footer className="mt-4 flex justify-center gap-2">
          <Button variant="secondary" onClick={handleCancel}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!canUpload}>
            Upload
          </Button>
        </footer>
      </Dialog>
    </>
  );
}
