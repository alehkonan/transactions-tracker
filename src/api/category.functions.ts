import { createServerFn } from "@tanstack/react-start";
import { inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "~/database/getDb.server";
import { categoriesTable } from "~/database/tables";
import { authMiddleware } from "./auth.middleware";
import { loggerMiddleware } from "./logger.middleware";

export const checkCategoryNames = createServerFn({ method: "POST" })
  .middleware([loggerMiddleware, authMiddleware])
  .validator(z.record(z.string(), z.number().optional()))
  .handler(async ({ data: bindings }) => {
    const res = await getDb().query.categoriesTable.findMany({
      where: inArray(categoriesTable.name, Object.keys(bindings)),
      columns: { id: true, name: true },
    });

    return {
      ...bindings,
      ...Object.fromEntries(res.map(({ id, name }) => [name, id])),
    };
  });

export const createCategoryNames = createServerFn({ method: "POST" })
  .middleware([loggerMiddleware, authMiddleware])
  .validator(z.array(z.string()))
  .handler(async ({ data: names }) => {
    return getDb()
      .insert(categoriesTable)
      .values([...new Set(names)].map((name) => ({ name })))
      .returning({ id: categoriesTable.id, name: categoriesTable.name });
  });
