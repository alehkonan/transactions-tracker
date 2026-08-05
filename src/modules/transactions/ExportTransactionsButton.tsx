import { Toast } from "@base-ui/react/toast";
import { useState } from "react";
import { exportTransactionsToCsv } from "~/api/transaction.functions";

/** Downloads the selected profile's transactions as a CSV file. */
export function ExportTransactionsButton() {
  const [isExporting, setIsExporting] = useState(false);
  const toastManager = Toast.useToastManager();

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const { csv, count } = await exportTransactionsToCsv();
      if (count === 0) {
        toastManager.add({ description: "No transactions found." });
        return;
      }

      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "transactions.csv";
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleExport}
      disabled={isExporting}
      className="text-accent cursor-pointer text-sm hover:underline disabled:opacity-50"
    >
      Export transactions
    </button>
  );
}
