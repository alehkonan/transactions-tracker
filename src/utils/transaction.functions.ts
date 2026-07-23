import { createServerFn } from "@tanstack/react-start";
import { transactions } from "~/drizzle/schema";
import { getDb } from "~/lib/db.server";

export const getTransactions = createServerFn({ method: "GET" }).handler(async () => {
  return getDb().select().from(transactions);
});
