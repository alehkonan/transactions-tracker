import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "~/database/getDb.server";
import { categoriesTable, colorsTable } from "~/database/tables";
import { authMiddleware } from "./auth.middleware";
import { loggerMiddleware } from "./logger.middleware";
import { profileMiddleware } from "./profile.middleware";

export const getCategories = createServerFn()
  .middleware([loggerMiddleware, authMiddleware, profileMiddleware])
  .handler(({ context }) => {
    if (context.profileId == null) return [];

    return getDb()
      .select({
        id: categoriesTable.id,
        name: categoriesTable.name,
        colorHex: colorsTable.hex,
      })
      .from(categoriesTable)
      .leftJoin(colorsTable, eq(categoriesTable.colorId, colorsTable.id))
      .where(eq(categoriesTable.profileId, context.profileId));
  });

export const deleteCategory = createServerFn({ method: "POST" })
  .middleware([loggerMiddleware, authMiddleware])
  .validator(z.number())
  .handler(async ({ data: id }) => {
    await getDb().delete(categoriesTable).where(eq(categoriesTable.id, id));
  });

/** Deletes every category for the selected profile; transactions referencing them have their category cleared (set null). */
export const deleteAllCategories = createServerFn({ method: "POST" })
  .middleware([loggerMiddleware, authMiddleware, profileMiddleware])
  .handler(async ({ context }) => {
    if (context.profileId == null) return;

    await getDb().delete(categoriesTable).where(eq(categoriesTable.profileId, context.profileId));
  });
