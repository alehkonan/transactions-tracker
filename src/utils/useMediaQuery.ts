import { useCallback, useSyncExternalStore } from "react";

/**
 * Whether a CSS media query currently matches, e.g. `useMediaQuery("(min-width: 40rem)")`.
 *
 * For the cases a `sm:` utility cannot cover — where the two layouts are different components
 * rather than the same one restyled, and rendering both to hide one with CSS would mean building
 * the loser on every render.
 *
 * Subscribed through `useSyncExternalStore` rather than an effect, so the first paint already has
 * the right answer instead of flashing the desktop layout on a phone. The server snapshot is
 * `false`: nothing that uses this renders during SSR (`SyncGate` is what the server emits), and
 * mobile-first is the safer guess if anything ever does.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const mediaQueryList = window.matchMedia(query);
      mediaQueryList.addEventListener("change", onStoreChange);
      return () => mediaQueryList.removeEventListener("change", onStoreChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}
