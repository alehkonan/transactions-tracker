import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "~/database/getDb.server";
import { categoriesTable, colorsTable } from "~/database/tables";
import { authMiddleware } from "./auth.middleware";
import { loggerMiddleware } from "./logger.middleware";

export const getCategories = createServerFn()
  .middleware([loggerMiddleware, authMiddleware])
  .handler(() => {
    return getDb()
      .select({
        id: categoriesTable.id,
        name: categoriesTable.name,
        colorHex: colorsTable.hex,
      })
      .from(categoriesTable)
      .leftJoin(colorsTable, eq(categoriesTable.colorId, colorsTable.id));
  });

export const deleteCategory = createServerFn({ method: "POST" })
  .middleware([loggerMiddleware, authMiddleware])
  .validator(z.number())
  .handler(async ({ data: id }) => {
    await getDb().delete(categoriesTable).where(eq(categoriesTable.id, id));
  });
