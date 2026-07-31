import { createServerFn } from "@tanstack/react-start";
import { getDb } from "~/database/getDb.server";
import { transactions } from "~/database/schema";
import { authMiddleware } from "./auth.middleware";
import { loggerMiddleware } from "./logger.middleware";

export const getTransactions = createServerFn()
  .middleware([loggerMiddleware, authMiddleware])
  .handler(async () => {
    return getDb().select().from(transactions);
  });
