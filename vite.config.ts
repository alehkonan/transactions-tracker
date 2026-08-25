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
  // gsap's subpath files (gsap/Flip, …) are ESM source but the package has no
  // `type: "module"`, so Node's ESM loader treats them as CommonJS and a named
  // `import { Flip }` crashes the deployed function. Bundling gsap into the SSR
  // output instead of externalizing it lets Vite resolve the interop at build time.
  ssr: {
    noExternal: ["gsap", "@gsap/react"],
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
    offlineServiceWorker(),
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
