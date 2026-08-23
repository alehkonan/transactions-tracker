import { Button } from "~/components/Button";
import { FileInput } from "~/components/FileInput";
import { actions, useTransactionsImport } from "./useTransactionsImport";
import { IMPORT_HEADERS } from "./utils";

export function UploadStep() {
  const file = useTransactionsImport((state) => state.file);
  const rows = useTransactionsImport((state) => state.rows);
  const uploadError = useTransactionsImport((state) => state.uploadError);

  return (
    <div className="flex flex-col gap-4">
      <FileInput
        file={file}
        accept="text/csv"
        onFileChange={(nextFile) => {
          if (nextFile) actions.selectFile(nextFile);
          else actions.clearFile();
        }}
      />
      <p className="text-text-muted text-sm">
        Required columns: <span className="font-mono">{IMPORT_HEADERS.join(", ")}</span>
      </p>
      {uploadError && <p className="text-danger text-sm">{uploadError}</p>}
      <footer className="flex justify-center">
        <Button variant="primary" disabled={!rows} onClick={actions.startImport}>
          Next
        </Button>
      </footer>
    </div>
  );
}
