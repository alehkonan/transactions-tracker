import { Toast } from "@base-ui/react/toast";
import { useTransactionRows } from "~/modules/transactions/useTransactionRows";
import { toCsv } from "~/utils/to-csv";

const CSV_HEADERS = [
  "Date",
  "Type",
  "Account",
  "Category",
  "Necessity level",
  "Amount",
  "Currency",
  "Comment",
];

/**
 * Downloads the selected profile's transactions as a CSV file.
 *
 * Built here rather than on the server: the rows, with their account and category names already
 * resolved, are in memory — so the export is instant, works offline, and needs no endpoint.
 */
export function ExportTransactionsButton() {
  const transactions = useTransactionRows();
  const toastManager = Toast.useToastManager();

  const handleExport = () => {
    if (transactions.length === 0) {
      toastManager.add({ description: "No transactions found." });
      return;
    }

    const csv = toCsv(
      CSV_HEADERS,
      transactions.map((row) => [
        row.createdAt.toISOString(),
        row.type,
        row.account,
        row.category,
        row.necessityLevel,
        row.amount,
        row.currencyCode,
        row.comment,
      ]),
    );

    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "transactions.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <button
      type="button"
      onClick={handleExport}
      className="text-accent cursor-pointer text-sm hover:underline"
    >
      Export transactions
    </button>
  );
}
