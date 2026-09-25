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
  const showNavbar = !isStandalone && isHydrated;

  return (
    <Toast.Provider>
      <ServiceWorkerRegistration />
      {showNavbar && (
        <header
          className={twJoin(
            "pointer-events-none",
            "flex items-center justify-center px-3 pt-3 pb-[calc(env(safe-area-inset-bottom)+1.25rem)]",
            "z-navbar fixed inset-x-0 bottom-0",
            "md:sticky md:top-0 md:bottom-auto md:p-3",
          )}
        >
          <Suspense fallback={null}>
            <Navbar />
          </Suspense>
        </header>
      )}
      <div
        className={twJoin(
          "flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto",
          !isLogin && (showNavbar ? "pt-12 md:pt-0" : "pt-12 md:pt-14"),
          showNavbar && "pb-[calc(env(safe-area-inset-bottom)+5rem)] md:pb-0",
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
