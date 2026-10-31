import { Toast } from "@base-ui/react/toast";
import { TanStackDevtools } from "@tanstack/react-devtools";
import { Outlet, createFileRoute, useRouterState } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { lazy, Suspense } from "react";
import { twJoin } from "tailwind-merge";
import { Loader } from "~/components/Loader";
import { ServiceWorkerRegistration } from "~/components/ServiceWorkerRegistration";
import { Toaster } from "~/components/Toaster";
import { useSyncStore } from "~/modules/sync/useSyncStore";

const Navbar = lazy(() =>
  import("~/components/Navbar").then((module) => ({ default: module.Navbar })),
);
const SyncGate = lazy(() =>
  import("~/modules/sync/SyncGate").then((module) => ({ default: module.SyncGate })),
);

export const Route = createFileRoute("/_client")({
  ssr: false,
  pendingMinMs: 0,
  component: ClientLayout,
});

function ClientLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const isStandalone = pathname === "/profile" || pathname === "/login";
  const isLogin = pathname === "/login";
  const isHydrated = useSyncStore((state) => state.isHydrated);
  const replicaId = useSyncStore((state) => state.replicaContext?.replicaId);
  const profileId = useSyncStore((state) => state.selectedProfileId);
  const showNavbar = !isStandalone && isHydrated;

  return (
    <Toast.Provider>
      <ServiceWorkerRegistration />
      {isHydrated && (
        <footer hidden={!showNavbar} className="z-navbar order-last shrink-0">
          <Suspense fallback={<div className="h-16" />}>
            <Navbar key={`${replicaId}:${profileId}`} />
          </Suspense>
        </footer>
      )}
      <div
        id="app-scroll"
        data-tab-scroll
        className={twJoin(
          "flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto",
          !isLogin &&
            "pt-[calc(env(safe-area-inset-top)+3rem)] md:pt-[calc(env(safe-area-inset-top)+3.5rem)]",
        )}
      >
        {isLogin ? (
          <Outlet />
        ) : (
          <Suspense fallback={<Loader />}>
            <SyncGate>
              <Outlet />
            </SyncGate>
          </Suspense>
        )}
      </div>
      <Toaster />
      <TanStackDevtools
        config={{ position: "top-right" }}
        plugins={[
          {
            name: "Tanstack Router",
            render: <TanStackRouterDevtoolsPanel />,
          },
        ]}
      />
    </Toast.Provider>
  );
}
