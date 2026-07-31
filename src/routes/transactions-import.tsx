import { createFileRoute } from "@tanstack/react-router";
import { ListChecksIcon, UploadIcon } from "lucide-react";
import { PageContainer } from "~/components/PageContainer";
import { Step, Stepper } from "~/components/Stepper";
import { CheckHeadersStep } from "~/modules/transactions/import/CheckHeadersStep";
import { UploadStep } from "~/modules/transactions/import/UploadStep";
import { useTransactionsImport } from "~/modules/transactions/import/useTransactionsImport";

export const Route = createFileRoute("/transactions-import")({
  component: () => {
    const { csv } = useTransactionsImport();

    const isUploadStep = !csv;
    const isCheckStep = !!csv;

    return (
      <PageContainer>
        <Stepper>
          <Step
            icon={<UploadIcon className="size-4" />}
            label="Upload file"
            isActive={isUploadStep}
          />
          <Step icon={<ListChecksIcon className="size-4" />} label="Check" isActive={isCheckStep} />
        </Stepper>
        <div className="p-3" />
        {isUploadStep && <UploadStep />}
        {isCheckStep && <CheckHeadersStep csv={csv} />}
      </PageContainer>
    );
  },
});
