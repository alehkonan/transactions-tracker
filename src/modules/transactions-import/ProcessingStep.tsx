import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "~/components/Button";
import { Dialog } from "~/components/Dialog";
import { Loader } from "~/components/Loader";
import { actions, useTransactionsImport } from "./useTransactionsImport";

export function ProcessingStep() {
  const navigate = useNavigate();
  const report = useTransactionsImport((state) => state.report);
  const isCancelling = useTransactionsImport((state) => state.isCancelling);
  const removalError = useTransactionsImport((state) => state.removalError);
  const localRefreshError = useTransactionsImport((state) => state.localRefreshError);
  const [confirmRemoval, setConfirmRemoval] = useState(false);

  if (!report) {
    return (
      <section
        aria-live="polite"
        aria-busy="true"
        className="bg-surface flex flex-col items-center gap-3 rounded-lg p-6 text-center"
      >
        <Loader />
        <h2 className="font-semibold">Saving transactions on this device…</h2>
        <p className="text-text-muted text-sm">
          Keep this page open until the local import finishes. Synchronization continues separately.
        </p>
      </section>
    );
  }

  return (
    <div data-testid="import-report" className="space-y-5">
      <section
        className="bg-surface divide-border divide-y rounded-lg"
        aria-labelledby="import-result-heading"
      >
        <div className="p-4" aria-live="polite">
          <h2 id="import-result-heading" className="text-lg font-semibold">
            {localRefreshError
              ? "Changes saved; reload needed"
              : report.createdCount > 0
                ? "Import saved on this device"
                : "No transactions imported"}
          </h2>
          <p className="text-text-muted mt-1 text-sm">
            {localRefreshError
              ? "The local write finished. Reload this page before continuing."
              : report.createdCount > 0
                ? "You can view your transactions now. Changes sync automatically when a connection is available."
                : "Review the row errors below, correct the CSV, and try again."}
          </p>
        </div>
        <dl className="divide-border divide-y">
          <div className="flex justify-between gap-4 px-4 py-3">
            <dt>Transactions created</dt>
            <dd className="font-semibold tabular-nums">{report.createdCount.toLocaleString()}</dd>
          </div>
          <div className="flex justify-between gap-4 px-4 py-3">
            <dt>Rows failed</dt>
            <dd className="font-semibold tabular-nums">{report.failedCount.toLocaleString()}</dd>
          </div>
          <div className="flex justify-between gap-4 px-4 py-3">
            <dt className="text-text-muted">Time spent</dt>
            <dd className="tabular-nums">{(report.durationMs / 1000).toFixed(1)}s</dd>
          </div>
        </dl>
      </section>
      {report.warnings.length > 0 && (
        <section
          className="bg-surface rounded-lg p-4 text-sm wrap-anywhere"
          aria-labelledby="import-warnings-heading"
        >
          <h3 id="import-warnings-heading" className="text-warning font-semibold">
            Some accounts were imported in a different currency
          </h3>
          <ul className="mt-2 space-y-2">
            {report.warnings.map((warning) => (
              <li key={warning.currency}>
                {warning.currency} is not supported yet —{" "}
                {warning.accounts
                  .map((account) => account.name + " uses " + account.currencyCode)
                  .join(", ")}
                .
              </li>
            ))}
          </ul>
        </section>
      )}
      {report.failures.length > 0 && (
        <section className="bg-surface rounded-lg" aria-labelledby="import-failures-heading">
          <h3 id="import-failures-heading" className="p-4 font-semibold">
            Row errors
          </h3>
          {/* oxlint-disable jsx-a11y/no-noninteractive-tabindex -- A scrollable error list needs keyboard focus so all rows can be read without a pointer. */}
          <ul
            data-testid="import-failures"
            tabIndex={0}
            aria-labelledby="import-failures-heading"
            className="divide-border focus-visible:ring-accent max-h-80 divide-y overflow-y-auto overscroll-contain rounded-b-lg text-sm focus-visible:ring-2 focus-visible:outline-none"
          >
            {report.failures.map((failure) => (
              <li key={failure.row} className="px-4 py-3 wrap-anywhere">
                <span className="font-medium">Row {failure.row}: </span>
                <span className="text-danger">{failure.reason}</span>
              </li>
            ))}
          </ul>
          {/* oxlint-enable jsx-a11y/no-noninteractive-tabindex */}
          {report.createdCount > 0 && (
            <p className="text-text-muted p-4 text-sm">
              Only retry failed rows in a new file. Reimporting successful rows creates duplicates.
            </p>
          )}
        </section>
      )}
      {removalError && (
        <p
          role="alert"
          data-testid="import-removal-error"
          className="text-danger bg-surface rounded-lg p-4 text-sm wrap-anywhere"
        >
          {removalError} You can retry removal.
        </p>
      )}
      {localRefreshError && (
        <p
          role="alert"
          data-testid="import-refresh-error"
          className="text-danger bg-surface rounded-lg p-4 text-sm wrap-anywhere"
        >
          {localRefreshError}
        </p>
      )}
      {isCancelling && (
        <output className="text-text-muted block text-sm">
          Removing imported transactions from this device…
        </output>
      )}
      <footer className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:justify-end">
        {localRefreshError ? (
          <Button
            data-testid="import-reload"
            variant="primary"
            onClick={() => window.location.reload()}
          >
            Reload saved transactions
          </Button>
        ) : (
          <>
            {report.createdCount > 0 ? (
              <Button
                data-testid="import-discard"
                variant="danger"
                disabled={isCancelling}
                onClick={() => setConfirmRemoval(true)}
              >
                Remove imported transactions
              </Button>
            ) : (
              <Button data-testid="import-try-another" variant="secondary" onClick={actions.reset}>
                Choose another file
              </Button>
            )}
            <Button
              data-testid="import-proceed"
              variant="primary"
              disabled={isCancelling}
              onClick={() => void navigate({ to: "/transactions" })}
            >
              View transactions
            </Button>
          </>
        )}
      </footer>
      <Dialog
        title="Remove imported transactions?"
        open={confirmRemoval}
        onOpenChange={setConfirmRemoval}
        requireAction
      >
        <p className="mt-3 text-sm">
          This deletes the {report.createdCount.toLocaleString()} saved transactions from this
          import, including linked transfers and their allocations. Accounts and categories created
          by the import will remain. The deletions sync automatically.
        </p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button
            variant="secondary"
            data-testid="import-keep-saved"
            onClick={() => setConfirmRemoval(false)}
          >
            Keep transactions
          </Button>
          <Button
            variant="danger"
            data-testid="import-confirm-removal"
            onClick={() => {
              setConfirmRemoval(false);
              void actions.discardImportedTransactions();
            }}
          >
            Remove transactions
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
