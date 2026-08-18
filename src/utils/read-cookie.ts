import { createIsomorphicFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";

/**
 * Reads a cookie from wherever the caller happens to be running — the request during SSR, and
 * `document.cookie` after hydration.
 *
 * Route guards run in both places, so this is what lets them decide without an RPC. The server
 * branch (and its import) is compiled out of the client bundle by the TanStack Start plugin, the
 * same way a server function's handler is.
 */
export const readCookie = createIsomorphicFn()
  .server((name: string) => getCookie(name))
  .client((name: string) => {
    const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : undefined;
  });
