import { createMiddleware } from "@tanstack/react-start";
import { authMiddleware } from "./auth.middleware";
import { getSelectedProfileIdFromCookie } from "./selected-profile.server";

/**
 * Injects the cookie-selected profile id into the handler's `context` as `profileId`, or `null`
 * when nothing is selected — or when the selected profile belongs to somebody else. Requires a
 * signed-in caller, since ownership is what the id is checked against.
 */
export const profileMiddleware = createMiddleware()
  .middleware([authMiddleware])
  .server(async ({ next, context }) => {
    return next({ context: { profileId: await getSelectedProfileIdFromCookie(context.user.id) } });
  });
