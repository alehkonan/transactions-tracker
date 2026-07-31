import { createMiddleware } from "@tanstack/react-start";

export const loggerMiddleware = createMiddleware().server(({ next }) => {
  // TODO implement logger

  return next();
});
