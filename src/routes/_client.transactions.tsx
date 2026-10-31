import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { TransactionsScreen } from "~/screens/TransactionsScreen";

const dateKeySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional();

export const Route = createFileRoute("/_client/transactions")({
  validateSearch: z.object({
    from: dateKeySchema,
    to: dateKeySchema,
    account: z.string().optional(),
    category: z.string().optional(),
    q: z.string().optional(),
  }),
  component: TransactionsScreen,
});
