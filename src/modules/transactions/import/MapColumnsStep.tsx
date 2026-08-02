import { useNavigate } from "@tanstack/react-router";
import { useTransition } from "react";
import { createTransactions } from "~/api/transaction.functions";
import { Button } from "~/components/Button";
import { DataTable } from "~/components/DataTable";
import { Title } from "~/components/Title";
import { getMapColumnsTableColumns } from "./mapColumnsTableColumns";
import { actions, useTransactionsImport } from "./useTransactionsImport";
import { buildTransactionInputs } from "./utils";
import type { ParsedCsv } from "~/utils/parseCsv";

const PREVIEW_ROW_COUNT = 10;

type Props = {
  csv: ParsedCsv;
};

export function MapColumnsStep({ csv }: Props) {
  const navigate = useNavigate();
  const [isCreating, startTransition] = useTransition();
  const columnMapping = useTransactionsImport((state) => state.columnMapping);
  const accountBindings = useTransactionsImport((state) => state.accountBindings);
  const categoryBindings = useTransactionsImport((state) => state.categoryBindings);

  const columns = getMapColumnsTableColumns({
    csv,
    columnMapping,
    accountBindings,
    categoryBindings,
    onMappingChange: actions.setColumnMapping,
  });

  const handleCreateTransactions = () => {
    startTransition(async () => {
      const inputs = buildTransactionInputs(csv, columnMapping, accountBindings, categoryBindings);
      await createTransactions({ data: inputs });
      actions.reset();
      navigate({ to: "/transactions" });
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <Title variant="section">Map columns</Title>
      <DataTable columns={columns} data={csv.rows.slice(0, PREVIEW_ROW_COUNT)} />
      <footer className="flex justify-center gap-2">
        <Button variant="secondary" disabled={isCreating} onClick={actions.goToCheck}>
          Back
        </Button>
        <Button variant="primary" disabled={isCreating} onClick={handleCreateTransactions}>
          {isCreating ? "Creating…" : "Create transactions"}
        </Button>
      </footer>
    </div>
  );
}
