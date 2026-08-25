import { promises as fs } from "node:fs";
import { basename, resolve } from "node:path";
import type { Plugin, ResolvedConfig } from "vite";

/** Stamps the standalone worker with the assets and IndexedDB contract emitted by this build. */
export function offlineServiceWorker(): Plugin {
  let config: ResolvedConfig;

  return {
    name: "offline-service-worker",
    apply: "build",
    configResolved(resolved) {
      config = resolved;
    },
    async writeBundle(options, bundle) {
      // The client and SSR builds share this plugin. Only the client output is served to the worker.
      const outDir = options.dir ?? resolve(config.root, config.build.outDir);
      if (basename(outDir) !== "client") return;

      const precache = Object.keys(bundle)
        .filter((fileName) => fileName.startsWith("assets/"))
        .map((fileName) => `/${fileName}`);
      const template = await fs.readFile(resolve(config.root, "public/sw.js"), "utf8");
      const worker = template
        .replace("__BUILD_ID__", JSON.stringify(`build-${Date.now()}`))
        .replace("__PRECACHE__", JSON.stringify(precache))
        .replace("__DATABASE_NAME__", JSON.stringify("transactions-tracker"))
        .replace("__DATABASE_VERSION__", "2");

      await fs.writeFile(resolve(outDir, "sw.js"), worker);
    },
  };
}
