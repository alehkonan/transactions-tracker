import netlify from "@netlify/vite-plugin-tanstack-start";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

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
    }),
    devtools({
      // data-tsd-source attributes diverge between the SSR and client
      // transforms in devtools-vite, causing hydration mismatch warnings.
      injectSource: { enabled: false },
    }),
    netlify(),
    viteReact(),
    tailwindcss(),
  ],
  server: {
    port: 5454,
    host: true,
  },
  preview: {
    port: 5454,
    host: true,
  },
});
