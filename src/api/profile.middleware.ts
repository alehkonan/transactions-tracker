import { createMiddleware } from "@tanstack/react-start";
import { authMiddleware } from "./auth.middleware";
import { getSelectedProfileIdFromCookie } from "./selected-profile.server";

/**
 * Injects the cookie-selected profile id into the handler's `context` as `profileId`, or `null`
 * when nothing is selected — or when the selection belongs to somebody else. Requires a signed-in
 * caller, since ownership is what the id is checked against.
 */
export const profileMiddleware = createMiddleware()
  .middleware([authMiddleware])
  .server(({ next, context }) => {
    return next({ context: { profileId: getSelectedProfileIdFromCookie(context.user.id) } });
  });
