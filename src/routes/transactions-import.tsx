import { createFileRoute } from "@tanstack/react-router";
import { PageContainer } from "~/components/PageContainer";
import { Title } from "~/components/Title";
import {
  actions,
  useTransactionsImport,
} from "~/modules/transactions/import/useTransactionsImport";

export const Route = createFileRoute("/transactions-import")({
  component: () => {
    const { csv, fileName } = useTransactionsImport();

    return (
      <PageContainer>
        <Title variant="page">Import</Title>
        {!csv && (
          <input
            type="file"
            onChange={(e) => {
              const file = e.target.files?.item(0);
              if (!file) return console.warn("No file is chosen");
              actions.uploadAndParse(file);
            }}
          />
        )}
        {csv && <p>Uploaded file: {fileName}</p>}
      </PageContainer>
    );
  },
});
