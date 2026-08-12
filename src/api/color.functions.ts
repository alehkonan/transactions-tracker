import { createServerFn } from "@tanstack/react-start";
import { asc } from "drizzle-orm";
import { getDb } from "~/database/get-db.server";
import { colorsTable } from "~/database/tables";
import { authMiddleware } from "./auth.middleware";
import { loggerMiddleware } from "./logger.middleware";

/** The whole palette a category can be tinted with — shared across profiles, never edited from the UI. */
export const getColors = createServerFn()
  .middleware([loggerMiddleware, authMiddleware])
  .handler(() => {
    return getDb()
      .select({ id: colorsTable.id, hex: colorsTable.hex })
      .from(colorsTable)
      .orderBy(asc(colorsTable.id));
  });
