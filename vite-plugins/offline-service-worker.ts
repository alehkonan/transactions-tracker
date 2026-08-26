import { promises as fs } from "node:fs";
import { basename, resolve } from "node:path";
import { transformWithOxc, type Plugin, type ResolvedConfig } from "vite";

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
      if (!template.includes("__OUTBOX_ACCEPTANCE_KERNEL__")) {
        throw new Error("The service-worker template is missing the outbox acceptance marker.");
      }

      const kernelPath = resolve(config.root, "src/modules/sync/outbox-acceptance.ts");
      const kernelSource = await fs.readFile(kernelPath, "utf8");
      const { code: transformedKernel } = await transformWithOxc(kernelSource, kernelPath, {
        lang: "ts",
      });
      const kernel = transformedKernel.replace(/^export\\s+(?=(?:async\\s+)?function\\b)/gm, "");
      const standaloneKernel = `const __outboxAcceptanceKernel = (() => {\\n${kernel}\\nreturn { drainOutbox };\\n})();`;
      const worker = template
        .replace("__OUTBOX_ACCEPTANCE_KERNEL__", standaloneKernel)
        .replace("__BUILD_ID__", JSON.stringify(`build-${Date.now()}`))
        .replace("__PRECACHE__", JSON.stringify(precache))
        .replace("__DATABASE_NAME__", JSON.stringify("transactions-tracker"))
        .replace("__DATABASE_VERSION__", "2");

      await fs.writeFile(resolve(outDir, "sw.js"), worker);
    },
  };
}
