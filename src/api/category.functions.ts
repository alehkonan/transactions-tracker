import { createServerFn } from "@tanstack/react-start";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "~/database/get-db.server";
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
        colorId: categoriesTable.colorId,
        colorHex: colorsTable.hex,
      })
      .from(categoriesTable)
      .leftJoin(colorsTable, eq(categoriesTable.colorId, colorsTable.id))
      .where(eq(categoriesTable.profileId, context.profileId))
      .orderBy(asc(categoriesTable.name));
  });

/** `colorId` points at an existing `colors` row — the palette is fixed, categories only ever reference it. */
const categorySchema = z.object({
  name: z.string().trim().min(1),
  colorId: z.number(),
});

export const createCategory = createServerFn({ method: "POST" })
  .middleware([loggerMiddleware, authMiddleware, profileMiddleware])
  .validator(categorySchema)
  .handler(async ({ data, context }) => {
    if (context.profileId == null) return;

    await getDb()
      .insert(categoriesTable)
      .values({ ...data, profileId: context.profileId });
  });

const updateCategorySchema = categorySchema.extend({ id: z.uuid() });

export const updateCategory = createServerFn({ method: "POST" })
  .middleware([loggerMiddleware, authMiddleware, profileMiddleware])
  .validator(updateCategorySchema)
  .handler(async ({ data: { id, name, colorId }, context }) => {
    if (context.profileId == null) return;

    // Scoped by profile as well as id: the id alone comes from the client.
    await getDb()
      .update(categoriesTable)
      .set({ name, colorId, updatedAt: new Date() })
      .where(and(eq(categoriesTable.id, id), eq(categoriesTable.profileId, context.profileId)));
  });

export const deleteCategory = createServerFn({ method: "POST" })
  .middleware([loggerMiddleware, authMiddleware, profileMiddleware])
  .validator(z.uuid())
  .handler(async ({ data: id, context }) => {
    if (context.profileId == null) return;

    // Scoped by profile as well as id: the id alone comes from the client.
    await getDb()
      .delete(categoriesTable)
      .where(and(eq(categoriesTable.id, id), eq(categoriesTable.profileId, context.profileId)));
  });
