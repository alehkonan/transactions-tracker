import { createServerFn } from "@tanstack/react-start";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "~/database/get-db.server";
import { categoriesTable } from "~/database/tables";
import { authMiddleware } from "./auth.middleware";
import { loggerMiddleware } from "./logger.middleware";
import { profileMiddleware } from "./profile.middleware";

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
      .where(
        and(
          eq(categoriesTable.id, id),
          eq(categoriesTable.profileId, context.profileId),
          isNull(categoriesTable.deletedAt),
        ),
      );
  });

/**
 * Soft-deletes a category, so the deletion reaches clients through their next delta pull rather than
 * simply vanishing from the table (see `deleteAccount`).
 *
 * The transactions filed under it keep pointing at it. Rewriting them all would bump `updatedAt` on
 * every one — a large pull for no gain, since a client that no longer holds the category renders
 * those rows as having none, which is exactly what the old `onDelete: "set null"` produced.
 */
export const deleteCategory = createServerFn({ method: "POST" })
  .middleware([loggerMiddleware, authMiddleware, profileMiddleware])
  .validator(z.uuid())
  .handler(async ({ data: id, context }) => {
    if (context.profileId == null) return;

    const deletedAt = new Date();

    await getDb()
      .update(categoriesTable)
      .set({ deletedAt, updatedAt: deletedAt })
      .where(
        and(
          eq(categoriesTable.id, id),
          eq(categoriesTable.profileId, context.profileId),
          isNull(categoriesTable.deletedAt),
        ),
      );
  });
