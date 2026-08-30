import { Toast } from "@base-ui/react/toast";
import { TanStackDevtools } from "@tanstack/react-devtools";
import {
  HeadContent,
  Scripts,
  createRootRoute,
  redirect,
  useRouterState,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { twJoin } from "tailwind-merge";
import { Navbar } from "~/components/Navbar";
import { ServiceWorkerRegistration } from "~/components/ServiceWorkerRegistration";
import { Toaster } from "~/components/Toaster";
import { hasLiveSessionHint } from "~/modules/auth/session-hint";
import { hasSelectedProfileHint } from "~/modules/profile/profile-cookie";
import { SyncGate } from "~/modules/sync/SyncGate";
import { useSyncStore } from "~/modules/sync/useSyncStore";
import appCss from "~/styles.css?url";

export const Route = createRootRoute({
  beforeLoad: ({ location }) => {
    if (location.pathname === "/login") return;
    if (!hasLiveSessionHint()) throw redirect({ to: "/login" });
    if (location.pathname === "/profile") return;
    if (!hasSelectedProfileHint()) throw redirect({ to: "/profile" });
  },
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Transactions tracker" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "icon", href: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { rel: "icon", href: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  }),
  shellComponent: ({ children }) => {
    const pathname = useRouterState({ select: (state) => state.location.pathname });
    // Full-screen routes that stand on their own, without the app's navigation chrome.
    const isStandalone = pathname === "/profile" || pathname === "/login";
    // Every route reads from the replicated working set, so every route waits for it — except
    // `/login`, which has to render for someone who has no data (and no session) yet.
    const isLogin = pathname === "/login";
    // Navigation that leads nowhere is worse than no navigation: until the working set is in, every
    // destination is the same loading screen, so the navbar arrives with the app it navigates.
    // `isHydrated` is false during SSR too, so the server paints the same chrome-less screen the
    // client starts from and there is nothing to reconcile on hydration.
    const isHydrated = useSyncStore((state) => state.isHydrated);
    const showNavbar = !isStandalone && isHydrated;

    return (
      <html lang="en" suppressHydrationWarning>
        <head>
          <HeadContent />
        </head>
        <body className="bg-background text-text min-h-dvh font-sans">
          <Toast.Provider>
            <ServiceWorkerRegistration />
            {showNavbar && (
              <header
                className={twJoin(
                  "pointer-events-none",
                  "flex items-center justify-center px-3 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]",
                  "z-navbar fixed inset-x-0 bottom-0",
                  "md:sticky md:top-0 md:bottom-auto md:p-3",
                )}
              >
                <Navbar />
              </header>
            )}
            {/* Room for the two pieces of chrome that float over the page: the navbar, and the
                sync indicator at the top (a full-width strip on a phone, a corner pill from `md`).
                Written as one expression per edge, since two `md:pt-*` utilities would be settled
                by stylesheet order rather than by what is meant. */}
            <div
              className={twJoin(
                !isLogin && (showNavbar ? "pt-8 md:pt-0" : "pt-8 md:pt-14"),
                showNavbar && "pb-[calc(env(safe-area-inset-bottom)+5rem)] sm:pb-0",
              )}
            >
              {isLogin ? children : <SyncGate>{children}</SyncGate>}
            </div>
            <Toaster />
          </Toast.Provider>
          <TanStackDevtools
            plugins={[
              {
                name: "Tanstack Router",
                render: <TanStackRouterDevtoolsPanel />,
              },
            ]}
          />
          <Scripts />
        </body>
      </html>
    );
  },
});
