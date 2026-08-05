import { createServerFn } from "@tanstack/react-start";
import { getDb } from "~/database/getDb.server";
import { authMiddleware } from "./auth.middleware";
import { loggerMiddleware } from "./logger.middleware";

export const getCategories = createServerFn()
  .middleware([loggerMiddleware, authMiddleware])
  .handler(() => {
    return getDb().query.categoriesTable.findMany();
  });
