import { FileInput } from "~/components/FileInput";
import { actions } from "./useTransactionsImport";

export function UploadStep() {
  return (
    <FileInput
      accept="text/csv"
      onFileChange={(file) => {
        if (file) actions.uploadAndParse(file);
      }}
    />
  );
}
