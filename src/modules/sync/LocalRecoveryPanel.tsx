import { useState } from "react";
import { Button } from "~/components/Button";
import { Title } from "~/components/Title";
import { SignOutButton } from "~/modules/auth/SignOutButton";
import { createLocalRecoveryExport } from "./idb";

/** Safe exit for an ambiguous legacy replica whose owner cannot be proven automatically. */
export function LocalRecoveryPanel() {
  const [error, setError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const downloadRecovery = async () => {
    setError(null);
    setIsExporting(true);
    try {
      const recovery = await createLocalRecoveryExport();
      const blob = new Blob([`${JSON.stringify(recovery, null, 2)}\n`], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `transactions-tracker-recovery-${recovery.exportedAt.slice(0, 10)}.json`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch {
      setError("Could not create the recovery file. The local data was not changed.");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="flex max-w-lg flex-col gap-4 p-4 text-center">
      <div className="flex flex-col gap-1">
        <Title variant="card">Local data needs recovery</Title>
        <p className="text-text-muted text-sm">
          This browser contains legacy financial data whose owner cannot be proven safely. It will
          not be synchronized or assigned to a signed-in account.
        </p>
      </div>
      <p className="text-text-muted text-sm">
        Download the device-only recovery file before discarding this local copy. The file contains
        financial data and pending changes; store it securely.
      </p>
      {error && <p className="text-danger text-sm">{error}</p>}
      <div className="flex flex-wrap justify-center gap-2">
        <Button
          variant="secondary"
          onClick={() => void downloadRecovery()}
          disabled={isExporting}
          data-testid="download-local-recovery"
        >
          {isExporting ? "Preparing recovery…" : "Download recovery file"}
        </Button>
        <SignOutButton label="Discard local data" />
      </div>
    </div>
  );
}
