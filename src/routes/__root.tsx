import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router";
import appCss from "~/styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Cracker Tracker" },
      { name: "theme-color", content: "#9c480c" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "icon", href: "/icon.svg", type: "image/svg+xml" },
      { rel: "icon", href: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { rel: "shortcut icon", href: "/favicon.ico" },
      { rel: "apple-touch-icon", href: "/icons/apple-touch-icon.png", sizes: "180x180" },
    ],
  }),
  shellComponent: ({ children }) => (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="bg-background text-text flex h-dvh flex-col overflow-hidden font-sans">
        {children}
        <Scripts />
      </body>
    </html>
  ),
});
