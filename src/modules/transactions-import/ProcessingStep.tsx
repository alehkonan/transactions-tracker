import { useNavigate } from "@tanstack/react-router";
import { Button } from "~/components/Button";
import { Loader } from "~/components/Loader";
import { Title } from "~/components/Title";
import { actions, useTransactionsImport } from "./useTransactionsImport";

export function ProcessingStep() {
  const navigate = useNavigate();
  const report = useTransactionsImport((state) => state.report);
  const isCancelling = useTransactionsImport((state) => state.isCancelling);

  // No way out of this step any more, and nothing to wait for: an import is a write to the local
  // database now, so this is a flash rather than the minutes-long server call it used to be. What
  // takes time is the push behind it, which the app stays usable through.
  if (!report) {
    return (
      <div className="flex flex-col items-center gap-4">
        <Loader />
        <p className="text-text-muted">Importing transactions…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Title variant="section">Import report</Title>
      <dl className="border-border bg-surface-muted grid grid-cols-3 gap-4 rounded-xl border p-4">
        <div>
          <dt className="text-text-muted text-sm">Created</dt>
          <dd className="text-lg font-semibold">{report.createdCount}</dd>
        </div>
        <div>
          <dt className="text-text-muted text-sm">Failed</dt>
          <dd className="text-lg font-semibold">{report.failedCount}</dd>
        </div>
        <div>
          <dt className="text-text-muted text-sm">Time spent</dt>
          <dd className="text-lg font-semibold">{(report.durationMs / 1000).toFixed(1)}s</dd>
        </div>
      </dl>
      {report.warnings.length > 0 && (
        <div className="flex flex-col gap-1 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <p className="font-semibold text-amber-700 dark:text-amber-300">
            Some accounts were imported in a different currency
          </p>
          <ul className="flex flex-col gap-1 text-amber-700 dark:text-amber-300">
            {report.warnings.map((warning) => (
              <li key={warning.currency}>
                <span className="font-mono">{warning.currency}</span> isn&apos;t supported yet —{" "}
                {warning.accounts
                  .map((account) => `${account.name} uses ${account.currencyCode}`)
                  .join(", ")}
                .
              </li>
            ))}
          </ul>
        </div>
      )}
      {report.failures.length > 0 && (
        <ul className="border-border flex max-h-48 flex-col gap-1 overflow-auto rounded-xl border p-3 text-sm">
          {report.failures.map((failure) => (
            <li key={failure.row} className="text-red-600 dark:text-red-400">
              Row {failure.row}: {failure.reason}
            </li>
          ))}
        </ul>
      )}
      <footer className="flex justify-center gap-2">
        <Button
          variant="danger"
          disabled={isCancelling}
          onClick={actions.discardImportedTransactions}
        >
          {isCancelling ? "Removing…" : "Cancel"}
        </Button>
        <Button
          variant="primary"
          disabled={isCancelling}
          onClick={() => {
            actions.reset();
            navigate({ to: "/transactions" });
          }}
        >
          Proceed
        </Button>
      </footer>
    </div>
  );
}
