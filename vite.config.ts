import netlify from "@netlify/vite-plugin-tanstack-start";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    tanstackStart({
      importProtection: {
        behavior: "error",
      },
    }),
    devtools(),
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
