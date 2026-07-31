import type { ColumnDef } from "@tanstack/react-table";

export const transactionsTableColumns: ColumnDef<object>[] = [
  {
    accessorKey: "createdAt",
    header: "Datetime",
  },
  {
    accessorKey: "category",
    header: "Category",
  },
  {
    accessorKey: "necessityLevel",
    header: "Necessity",
  },
  {
    id: "income",
    header: "From",
    columns: [
      {
        accessorKey: "incomeAccountId",
        header: "Account",
      },
      {
        id: "incomeAmount",
        header: "Amount",
      },
    ],
  },
  {
    id: "to",
    header: "To",
    columns: [
      {
        accessorKey: "outcomeAccountId",
        header: "Account",
      },
      {
        id: "outcomeAmount",
        header: "Amount",
      },
    ],
  },
];
