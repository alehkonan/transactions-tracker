import { Toast } from "@base-ui/react/toast";
import { TanStackDevtools } from "@tanstack/react-devtools";
import { Outlet, createFileRoute, useRouterState } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { twJoin } from "tailwind-merge";
import { Navbar } from "~/components/Navbar";
import { ServiceWorkerRegistration } from "~/components/ServiceWorkerRegistration";
import { Toaster } from "~/components/Toaster";
import { SyncGate } from "~/modules/sync/SyncGate";
import { useSyncStore } from "~/modules/sync/useSyncStore";

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
          <Navbar />
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
          <SyncGate>
            <Outlet />
          </SyncGate>
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
