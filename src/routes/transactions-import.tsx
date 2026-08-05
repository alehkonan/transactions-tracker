import { createFileRoute } from "@tanstack/react-router";
import { ListChecksIcon, UploadIcon } from "lucide-react";
import { PageContainer } from "~/components/PageContainer";
import { Step, Stepper } from "~/components/Stepper";
import { ProcessingStep } from "~/modules/transactions-import/ProcessingStep";
import { UploadStep } from "~/modules/transactions-import/UploadStep";
import { useTransactionsImport } from "~/modules/transactions-import/useTransactionsImport";

export const Route = createFileRoute("/transactions-import")({
  component: () => {
    const step = useTransactionsImport((state) => state.step);

    return (
      <PageContainer>
        <Stepper>
          <Step
            icon={<UploadIcon className="size-4" />}
            label="Upload file"
            isActive={step === "upload"}
          />
          <Step
            icon={<ListChecksIcon className="size-4" />}
            label="Import"
            isActive={step === "processing"}
          />
        </Stepper>
        <div className="p-3" />
        {step === "upload" && <UploadStep />}
        {step === "processing" && <ProcessingStep />}
      </PageContainer>
    );
  },
});
