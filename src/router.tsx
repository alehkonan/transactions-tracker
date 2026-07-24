import { createRouter } from "@tanstack/react-router";
import { PageLoader } from "~/components/PageLoader";
import { NotFound } from "~/pages/NotFound";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  const router = createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    defaultNotFoundComponent: NotFound,
    // Render the new route's pending UI immediately instead of blocking on the
    // old page while the loader runs (default is a 1s delay, which feels laggy).
    defaultPendingComponent: PageLoader,
    defaultPendingMs: 0,
  });

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
