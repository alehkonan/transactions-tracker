import { useBlocker } from "@tanstack/react-router";
import { useEffect } from "react";
import { Button } from "~/components/Button";
import { Dialog } from "~/components/Dialog";
import { PageContainer } from "~/components/PageContainer";
import { PageHeader } from "~/components/PageHeader";
import { useSelectedProfileId } from "~/modules/profile/local-selection";
import { useSyncStore } from "~/modules/sync/useSyncStore";
import { ProcessingStep } from "~/modules/transactions-import/ProcessingStep";
import { UploadStep } from "~/modules/transactions-import/UploadStep";
import {
  actions,
  useTransactionsImport,
} from "~/modules/transactions-import/useTransactionsImport";

export function TransactionsImportScreen() {
  const step = useTransactionsImport((state) => state.step);
  const file = useTransactionsImport((state) => state.file);
  const report = useTransactionsImport((state) => state.report);
  const isCancelling = useTransactionsImport((state) => state.isCancelling);
  const localRefreshError = useTransactionsImport((state) => state.localRefreshError);
  const profileId = useSelectedProfileId();
  const replicaId = useSyncStore((state) => state.replicaContext?.replicaId);
  const profiles = useSyncStore((state) => state.profiles);
  const profile = profiles.find((candidate) => candidate.id === profileId);
  const isPending = (step === "processing" && !report) || isCancelling;
  const blocker = useBlocker({
    shouldBlockFn: () => {
      const current = useTransactionsImport.getState();
      return (
        Boolean(current.localRefreshError) ||
        current.isCancelling ||
        (Boolean(current.file) && !current.report)
      );
    },
    enableBeforeUnload: isPending || (Boolean(file) && !report),
    withResolver: true,
  });

  // Drafts and reports belong to this visit, profile and local identity. File reads are fenced
  // against cleanup; local writes retain their captured replica/profile context.
  useEffect(() => actions.reset, [profileId, replicaId]);

  const activeStep = report ? 2 : step === "upload" ? 0 : 1;
  return (
    <PageContainer className="pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
      <main className="mx-auto w-full max-w-2xl">
        <PageHeader title="Import transactions" backTo="/settings" backLabel="Settings" />
        <p className="text-text-muted mb-5 text-sm wrap-anywhere">
          Import into{" "}
          <span className="text-text font-medium">{profile?.name ?? "this profile"}</span>.
        </p>
        <ol
          aria-label="Import progress"
          className="border-border mb-6 grid grid-cols-3 border-b pb-3 text-sm"
        >
          {["Choose file", "Review & import", "Result"].map((label, index) => (
            <li
              key={label}
              aria-current={activeStep === index ? "step" : undefined}
              className={activeStep === index ? "font-semibold" : "text-text-muted"}
            >
              <span className="block tabular-nums">{index + 1}</span>
              {label}
            </li>
          ))}
        </ol>
        {step === "processing" ? <ProcessingStep /> : <UploadStep />}
        <Dialog
          title={
            localRefreshError
              ? "Reload saved changes"
              : isPending
                ? isCancelling
                  ? "Removing saved transactions…"
                  : "Import in progress…"
                : report
                  ? "Import saved on this device"
                  : "Discard changes?"
          }
          open={blocker.status === "blocked"}
          onOpenChange={(open) => {
            if (!open) blocker.reset?.();
          }}
          requireAction
        >
          <p className="mt-3 text-sm">
            {localRefreshError
              ? localRefreshError
              : isPending
                ? "Wait for this local operation to finish before leaving. These changes cannot be discarded as an unsaved form."
                : report
                  ? "Your imported transactions are saved. Synchronization continues separately."
                  : "Your selected file and import preparation will be cleared. No transactions have been saved."}
          </p>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button
              variant="secondary"
              data-testid="import-keep-editing"
              onClick={() => blocker.reset?.()}
            >
              {isPending || report ? "Stay here" : "Keep editing"}
            </Button>
            <Button
              variant={report ? "primary" : "danger"}
              data-testid="import-leave"
              disabled={isPending}
              onClick={() => {
                if (localRefreshError) window.location.reload();
                else {
                  actions.reset();
                  blocker.proceed?.();
                }
              }}
            >
              {localRefreshError
                ? "Reload saved transactions"
                : isPending
                  ? "Please wait"
                  : report
                    ? "Continue"
                    : "Discard changes"}
            </Button>
          </div>
        </Dialog>
      </main>
    </PageContainer>
  );
}
