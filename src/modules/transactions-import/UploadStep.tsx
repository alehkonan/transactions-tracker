import { Button } from "~/components/Button";
import { FileInput } from "~/components/FileInput";
import { actions, useTransactionsImport } from "./useTransactionsImport";
import { IMPORT_HEADERS } from "./utils";

export function UploadStep() {
  const file = useTransactionsImport((state) => state.file);
  const rows = useTransactionsImport((state) => state.rows);
  const step = useTransactionsImport((state) => state.step);
  const isReading = useTransactionsImport((state) => state.isReading);
  const uploadError = useTransactionsImport((state) => state.uploadError);
  const isReview = step === "review";

  return (
    <div className="space-y-5">
      <section
        className="bg-surface divide-border divide-y rounded-lg"
        aria-labelledby="import-file-heading"
      >
        <div className="space-y-3 p-4">
          <h2 id="import-file-heading" className="font-semibold">
            {isReview ? "Review your file" : "Choose a CSV file"}
          </h2>
          {isReview ? (
            <p className="wrap-anywhere">{file?.name}</p>
          ) : (
            <FileInput
              inputTestId="import-file"
              file={file}
              accept=".csv,text/csv"
              onFileChange={(nextFile) => {
                if (nextFile) void actions.selectFile(nextFile);
                else actions.clearFile();
              }}
            />
          )}
          <output className="text-text-muted block text-sm">
            {isReading
              ? "Reading file…"
              : rows
                ? `${rows.length.toLocaleString()} ${rows.length === 1 ? "row" : "rows"} ready to review. Nothing has been saved yet.`
                : "Select a file exported with the required columns below."}
          </output>
        </div>
        {!isReview && (
          <details className="px-4">
            <summary className="focus-visible:ring-accent flex min-h-11 cursor-pointer items-center text-sm underline underline-offset-4 focus-visible:ring-2">
              Required columns
            </summary>
            <ul className="text-text-muted space-y-1 pb-4 text-sm wrap-anywhere">
              {IMPORT_HEADERS.map((header) => (
                <li key={header}>{header}</li>
              ))}
            </ul>
          </details>
        )}
      </section>
      {isReview && rows && (
        <section
          className="bg-surface divide-border divide-y rounded-lg"
          aria-labelledby="import-preview-heading"
        >
          <div className="p-4">
            <h2 id="import-preview-heading" className="font-semibold">
              File preview
            </h2>
            <p className="text-text-muted mt-1 text-sm">
              First {Math.min(rows.length, 5)} of {rows.length.toLocaleString()} rows. Rows are
              validated when you import; any failures will be listed in the result.
            </p>
          </div>
          <ol className="divide-border divide-y" data-testid="import-preview">
            {rows.slice(0, 5).map((row, index) => (
              // oxlint-disable-next-line react/no-array-index-key -- CSV row position is stable within this read-only file preview.
              <li key={index} className="space-y-1 p-4 text-sm wrap-anywhere">
                <p className="font-medium">
                  Row {index + 1} · {row.createdDate || "No date"}
                </p>
                {row.comment && <p>{row.comment}</p>}
                {row.categoryName && <p className="text-text-muted">{row.categoryName}</p>}
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
                  <dt className="text-text-muted">From</dt>
                  <dd>
                    {row.outcomeAccountName || "—"} · {row.outcome || "0"}{" "}
                    {row.outcomeCurrencyShortTitle}
                  </dd>
                  <dt className="text-text-muted">To</dt>
                  <dd>
                    {row.incomeAccountName || "—"} · {row.income || "0"}{" "}
                    {row.incomeCurrencyShortTitle}
                  </dd>
                </dl>
              </li>
            ))}
          </ol>
        </section>
      )}
      {uploadError && (
        <div
          role="alert"
          className="bg-surface rounded-lg p-4 text-sm wrap-anywhere"
          data-testid="import-error"
        >
          <p className="text-danger font-medium">{uploadError}</p>
          <p className="text-text-muted mt-1">
            {isReview
              ? "Nothing was saved. Try importing again or choose another file."
              : "Remove this file and choose another CSV to try again."}
          </p>
        </div>
      )}
      {isReview && (
        <p className="text-text-muted text-sm">
          Import saves transactions on this device immediately. They sync when a connection is
          available. Importing the same file again may create duplicates.
        </p>
      )}
      <footer className="flex flex-col gap-3 sm:flex-row sm:justify-end">
        {isReview && (
          <Button data-testid="import-edit-file" variant="secondary" onClick={actions.editFile}>
            Change file
          </Button>
        )}
        <Button
          data-testid={isReview ? "import-confirm" : "import-next"}
          variant="primary"
          disabled={!rows || isReading}
          onClick={isReview ? actions.startImport : actions.reviewFile}
        >
          {isReview ? "Import transactions" : "Next"}
        </Button>
      </footer>
    </div>
  );
}
