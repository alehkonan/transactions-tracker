import { useRouter, useRouterState } from "@tanstack/react-router";
import { useSyncStore } from "~/modules/sync/useSyncStore";

type MoneyListPath =
  | "/accounts"
  | "/accounts/archived"
  | "/accounts/purposes"
  | "/accounts/purposes/archived";
const labels: Record<MoneyListPath, string> = {
  "/accounts": "Money",
  "/accounts/archived": "Archived accounts",
  "/accounts/purposes": "Spheres",
  "/accounts/purposes/archived": "Archived spheres",
};

declare module "@tanstack/react-router" {
  interface HistoryState {
    moneyListOrigin?: {
      path: MoneyListPath;
      profileId: string;
      replicaId: string;
      historyIndex: number;
    };
  }
}

/** Return to the actual list entry so the router restores its scroll position. */
export function useMoneyNavigation(fallback: MoneyListPath = "/accounts") {
  const router = useRouter();
  const location = useRouterState({ select: (state) => state.location });
  const profileId = useSyncStore((state) => state.selectedProfileId);
  const replicaId = useSyncStore((state) => state.replicaContext?.replicaId);
  const origin = location.state.moneyListOrigin;
  const canReturn =
    origin?.profileId === profileId &&
    origin?.replicaId === replicaId &&
    // oxlint-disable-next-line eslint/no-underscore-dangle -- TanStack Router's history state key.
    origin?.historyIndex === location.state.__TSR_index - 1;
  const path = location.pathname as MoneyListPath;
  return {
    listState:
      Object.hasOwn(labels, path) && profileId && replicaId
        ? {
            moneyListOrigin: {
              path,
              profileId,
              replicaId,
              // oxlint-disable-next-line eslint/no-underscore-dangle -- TanStack Router's history state key.
              historyIndex: location.state.__TSR_index,
            },
          }
        : {},
    backLabel: labels[canReturn && origin ? origin.path : fallback],
    back: () => {
      if (canReturn) router.history.back();
      else void router.navigate({ to: fallback, replace: true });
    },
  };
}
