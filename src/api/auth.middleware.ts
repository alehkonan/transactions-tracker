import { createMiddleware } from "@tanstack/react-start";

export const authMiddleware = createMiddleware().server(({ next }) => {
  // TODO implement auth

  return next();
});
