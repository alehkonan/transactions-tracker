import netlify from "@netlify/vite-plugin-tanstack-start";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";
import { offlineServiceWorker } from "./vite-plugins/offline-service-worker";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
  plugins: [
    tanstackStart({
      importProtection: {
        behavior: "error",
      },
      spa: {
        enabled: true,
        maskPath: "/",
        prerender: { outputPath: "/_shell", crawlLinks: false, retryCount: 0 },
      },
      prerender: {
        autoStaticPathsDiscovery: false,
        crawlLinks: false,
        failOnError: true,
      },
    }),
    devtools({
      // data-tsd-source attributes diverge between the SSR and client
      // transforms in devtools-vite, causing hydration mismatch warnings.
      injectSource: { enabled: false },
    }),
    netlify({
      dev: {
        // Keep local requests and Drizzle Kit on the same Docker database. Installing the hosted
        // SDK must not silently start a second, unmigrated local Netlify database.
        database: { enabled: false },
        // Vite owns dev routing and public files. Reading generated `dist/client/_redirects` here
        // mixes a previous production shell with unhashed dev modules and leaves every asset at 404.
        redirects: { enabled: false },
        staticFiles: { enabled: false },
      },
    }),
    offlineServiceWorker(),
    viteReact(),
    tailwindcss(),
  ],
  server: {
    port: 5454,
    host: true,
    strictPort: true,
  },
  preview: {
    port: 5454,
    host: true,
    strictPort: true,
  },
});
