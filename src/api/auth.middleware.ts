import { createMiddleware } from "@tanstack/react-start";
import { resolveSession } from "./session.server";

/**
 * Injects the caller's session into the handler's `context` as `user`, or `null` when they are
 * not signed in. Never throws — use it for handlers that have to answer for anonymous callers
 * too, such as the login page's own server functions.
 */
export const sessionMiddleware = createMiddleware().server(async ({ next }) => {
  return next({ context: { user: await resolveSession() } });
});

/**
 * Requires a signed-in caller, rejecting with a 401 otherwise, and narrows `context.user` to
 * non-null for the handler.
 */
export const authMiddleware = createMiddleware()
  .middleware([sessionMiddleware])
  .server(({ next, context }) => {
    if (!context.user) throw new Response("Unauthorized", { status: 401 });

    return next({ context: { user: context.user } });
  });
