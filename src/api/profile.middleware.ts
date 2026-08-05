import { createMiddleware } from "@tanstack/react-start";
import { getSelectedProfileIdFromCookie } from "./selected-profile.server";

/** Injects the cookie-selected profile id into the handler's `context` as `profileId`. */
export const profileMiddleware = createMiddleware().server(({ next }) => {
  return next({ context: { profileId: getSelectedProfileIdFromCookie() } });
});
