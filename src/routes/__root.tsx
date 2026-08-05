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
import { getSelectedProfileId } from "~/api/profile.functions";
import { Navbar } from "~/components/Navbar";
import { Toaster } from "~/components/Toaster";
import appCss from "~/styles.css?url";

export const Route = createRootRoute({
  beforeLoad: async ({ location }) => {
    if (location.pathname === "/profile") return;

    const profileId = await getSelectedProfileId();
    if (profileId === null) throw redirect({ to: "/profile" });
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

    return (
      <html lang="en" suppressHydrationWarning>
        <head>
          <HeadContent />
        </head>
        <body className="bg-background min-h-dvh">
          <Toast.Provider>
            {pathname !== "/profile" && (
              <header className="pointer-events-none sticky top-0 flex items-center justify-center p-4">
                <Navbar />
              </header>
            )}
            {children}
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
