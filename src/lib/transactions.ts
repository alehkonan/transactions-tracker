import { createServerFn } from "@tanstack/react-start";
import { transactions } from "~/drizzle/schema";
import { getDb } from "./db";

export const getTransactions = createServerFn({ method: "GET" }).handler(async () => {
  return getDb().select().from(transactions);
});
