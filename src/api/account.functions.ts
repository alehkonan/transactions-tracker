import { createServerFn } from "@tanstack/react-start";
import { inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "~/database/getDb.server";
import { accountsTable } from "~/database/tables";
import { authMiddleware } from "./auth.middleware";
import { loggerMiddleware } from "./logger.middleware";

export const getAccounts = createServerFn()
  .middleware([loggerMiddleware, authMiddleware])
  .handler(() => {
    return getDb().query.accountsTable.findMany();
  });

export const checkAccountNames = createServerFn({ method: "POST" })
  .middleware([loggerMiddleware, authMiddleware])
  .validator(z.record(z.string(), z.number().optional()))
  .handler(async ({ data: bindings }) => {
    const res = await getDb().query.accountsTable.findMany({
      where: inArray(accountsTable.name, Object.keys(bindings)),
      columns: { id: true, name: true },
    });

    return {
      ...bindings,
      ...Object.fromEntries(res.map(({ id, name }) => [name, id])),
    };
  });

export const createAccountNames = createServerFn({ method: "POST" })
  .middleware([loggerMiddleware, authMiddleware])
  .validator(z.array(z.string()))
  .handler(async ({ data: names }) => {
    return getDb()
      .insert(accountsTable)
      .values([...new Set(names)].map((name) => ({ name })))
      .returning({ id: accountsTable.id, name: accountsTable.name });
  });
