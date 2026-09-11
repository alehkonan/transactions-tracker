import { promises as fs } from "node:fs";
import { basename, resolve } from "node:path";
import { transformWithOxc, type Plugin, type ResolvedConfig } from "vite";

const OUTBOX_ACCEPTANCE_MARKER = "/* __OUTBOX_ACCEPTANCE_KERNEL__ */";

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
      const markerCount = template.split(OUTBOX_ACCEPTANCE_MARKER).length - 1;
      if (markerCount !== 1) {
        throw new Error(
          `The service-worker template must contain exactly one outbox acceptance marker; found ${markerCount}.`,
        );
      }

      const kernelPath = resolve(config.root, "src/modules/sync/outbox-acceptance.ts");
      const kernelSource = await fs.readFile(kernelPath, "utf8");
      const { code: transformedKernel } = await transformWithOxc(kernelSource, kernelPath, {
        lang: "ts",
      });
      const kernel = transformedKernel
        .replace(/^export\s+(?=(?:async\s+)?(?:function|class|const|let|var)\b)/gm, "")
        .replace(/^export\s*\{[^}]*\};?\s*$/gm, "");
      const standaloneKernel = `const __outboxAcceptanceKernel = (() => {
${kernel}
return { drainOutbox };
})();`;
      const worker = template
        .replace(OUTBOX_ACCEPTANCE_MARKER, standaloneKernel)
        .replace("__BUILD_ID__", JSON.stringify(`build-${Date.now()}`))
        .replace("__PRECACHE__", JSON.stringify(precache));

      await fs.writeFile(resolve(outDir, "sw.js"), worker);
    },
  };
}
