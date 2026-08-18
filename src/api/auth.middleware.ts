import { createMiddleware } from "@tanstack/react-start";
import { resolveSession } from "./session.server";

/**
 * Injects the caller's session into the handler's `context` as `user`, or `null` when they are not
 * signed in. Never throws.
 *
 * Not exported: every remaining server function either requires a caller (`authMiddleware`, below)
 * or is part of a ceremony that has no caller yet. Export it again if a handler needs to answer for
 * anonymous and signed-in callers alike.
 */
const sessionMiddleware = createMiddleware().server(async ({ next }) => {
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
