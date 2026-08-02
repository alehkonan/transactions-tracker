import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getDb } from "~/database/getDb.server";
import { authMiddleware } from "./auth.middleware";
import { loggerMiddleware } from "./logger.middleware";

export const checkCategoryNames = createServerFn()
  .middleware([loggerMiddleware, authMiddleware])
  .validator(z.record(z.string(), z.number().optional()))
  .handler(async ({ data: bindings }) => {
    const res = await getDb().query.categories.findMany({
      where: (categories, { inArray }) => inArray(categories.name, Object.keys(bindings)),
      columns: { id: true, name: true },
    });

    return {
      ...bindings,
      ...Object.fromEntries(res.map(({ id, name }) => [name, id])),
    };
  });
