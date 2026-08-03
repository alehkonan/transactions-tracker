import { FileInput } from "~/components/FileInput";
import { actions, useTransactionsImport } from "./useTransactionsImport";

export function UploadStep() {
  const uploadError = useTransactionsImport((state) => state.uploadError);

  return (
    <div className="flex flex-col gap-2">
      <FileInput
        accept="text/csv"
        onFileChange={(file) => {
          if (file) actions.uploadAndParse(file);
        }}
      />
      {uploadError && <p className="text-sm text-red-600 dark:text-red-400">{uploadError}</p>}
    </div>
  );
}
