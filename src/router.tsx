import { createRouter } from "@tanstack/react-router";
import { Loader } from "./components/Loader";
import { NotFoundPage } from "./components/NotFoundPage";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  const router = createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultNotFoundComponent: NotFoundPage,
    defaultPendingComponent: Loader,
    defaultPendingMs: 0,
  });

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
