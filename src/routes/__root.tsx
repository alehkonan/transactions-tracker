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
import { Toaster } from "~/components/Toaster";
import { hasLiveSessionHint } from "~/modules/auth/session-hint";
import { hasSelectedProfileHint } from "~/modules/profile/profile-cookie";
import appCss from "~/styles.css?url";

export const Route = createRootRoute({
  // Routing only, and deliberately synchronous: both checks read cookies the browser already has,
  // so a navigation costs no request and the app still opens with no network at all. The hints are
  // forgeable, which buys nothing — every server function proves the caller for itself, so a faked
  // hint renders an empty shell and 401s on the first call.
  beforeLoad: ({ location }) => {
    // The login page is the one route that has to render for signed-out visitors.
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
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: ({ children }) => {
    const pathname = useRouterState({ select: (state) => state.location.pathname });
    // Full-screen routes that stand on their own, without the app's navigation chrome.
    const isStandalone = pathname === "/profile" || pathname === "/login";

    return (
      <html lang="en" suppressHydrationWarning>
        <head>
          <HeadContent />
        </head>
        <body className="bg-background min-h-dvh">
          <Toast.Provider>
            {!isStandalone && (
              <header
                className={twJoin(
                  "pointer-events-none",
                  "flex items-center justify-center p-3",
                  "z-navbar fixed inset-x-0 bottom-0",
                  "md:sticky md:top-0 md:bottom-auto",
                )}
              >
                <Navbar />
              </header>
            )}
            <div className={isStandalone ? undefined : "pb-24 sm:pb-0"}>{children}</div>
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
