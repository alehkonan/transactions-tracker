import { createFileRoute } from "@tanstack/react-router";
import { Columns3Icon, ListChecksIcon, UploadIcon } from "lucide-react";
import { PageContainer } from "~/components/PageContainer";
import { Step, Stepper } from "~/components/Stepper";
import { CheckHeadersStep } from "~/modules/transactions/import/CheckHeadersStep";
import { MapColumnsStep } from "~/modules/transactions/import/MapColumnsStep";
import { UploadStep } from "~/modules/transactions/import/UploadStep";
import { useTransactionsImport } from "~/modules/transactions/import/useTransactionsImport";

export const Route = createFileRoute("/transactions-import")({
  component: () => {
    const { csv, step } = useTransactionsImport();

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
            label="Check"
            isActive={step === "check"}
          />
          <Step
            icon={<Columns3Icon className="size-4" />}
            label="Map columns"
            isActive={step === "map"}
          />
        </Stepper>
        <div className="p-3" />
        {step === "upload" && <UploadStep />}
        {step === "check" && csv && <CheckHeadersStep csv={csv} />}
        {step === "map" && csv && <MapColumnsStep csv={csv} />}
      </PageContainer>
    );
  },
});
