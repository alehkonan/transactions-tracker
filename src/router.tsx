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
    // No route fetches data any more — reads come from the in-memory working set — so the only thing
    // a navigation can wait for is its own code chunk. Showing the pending component at 0ms turned
    // every navigation into a spinner flash and threw away the page the user was already looking at;
    // past this threshold the current route simply stays on screen instead.
    defaultPendingMs: 500,
  });

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
