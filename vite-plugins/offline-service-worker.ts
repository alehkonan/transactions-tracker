import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { basename, resolve } from "node:path";
import { transformWithOxc, type Plugin, type ResolvedConfig } from "vite";
import { INDEXED_DB_NAME, INDEXED_DB_VERSION } from "../src/modules/sync/indexed-db-contract";
import { isUiPath, UI_PATHS, uiRewritePaths } from "./ui-shell";

const OUTBOX_ACCEPTANCE_MARKER = "/* __OUTBOX_ACCEPTANCE_KERNEL__ */";
const ARTIFACT_METADATA_FILE = "offline-artifacts.json";

type ArtifactMetadata = {
  buildId: string;
  shellUrl: string;
  precache: readonly string[];
  uiPaths: readonly string[];
};

type RuntimeAsset = {
  url: string;
  content: Buffer;
};

/** Finalizes the SPA shell only after TanStack Start has completed client prerendering. */
export function offlineServiceWorker(): Plugin {
  let config: ResolvedConfig;
  let clientOutDir: string | undefined;

  return {
    name: "offline-service-worker",
    apply: "build",
    enforce: "post",
    configResolved(resolved) {
      config = resolved;
    },
    writeBundle(options) {
      const outDir = options.dir ?? resolve(config.root, config.build.outDir);
      if (basename(outDir) === "client") clientOutDir = outDir;
    },
    buildApp: {
      order: "post",
      async handler() {
        await finalizeOfflineArtifacts(
          config.root,
          clientOutDir ?? resolve(config.root, "dist", "client"),
        );
      },
    },
    configurePreviewServer(server) {
      return () => {
        server.middlewares.use(async (request, response, next) => {
          if (request.method !== "GET" || !request.url) return next();

          const url = new URL(request.url, "http://preview.local");
          // Start requests this artifact while prerendering. Rewriting it would recurse before the
          // finalizer has produced the versioned shell.
          if (url.pathname.startsWith("/_shell")) return next();
          if (!isUiPath(url.pathname)) return next();

          try {
            const metadata = await readArtifactMetadata(config.root, "dist");
            if (!metadata || !metadata.uiPaths.includes(url.pathname.replace(/\/$/, "") || "/")) {
              return next();
            }
            const shell = await fs.readFile(
              resolve(config.root, "dist", "client", metadata.shellUrl.slice(1)),
            );
            response.statusCode = 200;
            response.setHeader("Content-Type", "text/html; charset=utf-8");
            response.setHeader("Cache-Control", "public, immutable, max-age=31536000");
            response.end(shell);
          } catch (error) {
            next(error as Error);
          }
        });
      };
    },
  };
}

export async function finalizeOfflineArtifacts(
  root: string,
  outDir: string,
): Promise<ArtifactMetadata> {
  if (basename(outDir) !== "client") {
    throw new Error(`Expected the client output directory, received ${outDir}.`);
  }

  const shellSourcePath = resolve(outDir, "_shell.html");
  let shell: Buffer;
  try {
    shell = await fs.readFile(shellSourcePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`TanStack Start did not emit the SPA shell at ${shellSourcePath}.`, {
        cause: error,
      });
    }
    throw error;
  }

  const workerTemplate = await createWorkerTemplate(root);
  const runtimeAssets = await listRuntimeAssets(outDir);
  const protocol = JSON.stringify({
    indexedDbName: INDEXED_DB_NAME,
    indexedDbVersion: INDEXED_DB_VERSION,
    uiPaths: UI_PATHS,
  });
  const buildHash = createHash("sha256").update(shell).update("\0");
  for (const asset of runtimeAssets) {
    buildHash.update(asset.url).update("\0").update(asset.content).update("\0");
  }
  const buildId = buildHash
    .update(workerTemplate)
    .update("\0")
    .update(protocol)
    .digest("hex")
    .slice(0, 20);
  const shellUrl = `/_shell/${buildId}/`;
  const versionedShellPath = resolve(outDir, "_shell", buildId, "index.html");

  await fs.mkdir(resolve(outDir, "_shell", buildId), { recursive: true });
  await fs.writeFile(versionedShellPath, shell);

  const precache = [...new Set([shellUrl, ...runtimeAssets.map((asset) => asset.url)])].toSorted();
  await verifyPrecache(outDir, precache);

  const worker = workerTemplate
    .replace("__BUILD_ID__", JSON.stringify(buildId))
    .replace("__DATABASE_NAME__", JSON.stringify(INDEXED_DB_NAME))
    .replace("__DATABASE_VERSION__", String(INDEXED_DB_VERSION))
    .replace("__SHELL_URL__", JSON.stringify(shellUrl))
    .replace("__PRECACHE__", JSON.stringify(precache))
    .replace("__NAVIGATION_PATHS__", JSON.stringify(UI_PATHS));
  if (/__[A-Z][A-Z0-9_]*__/.test(worker)) {
    throw new Error("The generated service worker contains an unresolved placeholder.");
  }

  const metadata: ArtifactMetadata = { buildId, shellUrl, precache, uiPaths: UI_PATHS };
  await Promise.all([
    fs.writeFile(resolve(outDir, "sw.js"), worker),
    fs.writeFile(resolve(outDir, "_redirects"), createRedirects(shellUrl)),
    fs.writeFile(resolve(outDir, ARTIFACT_METADATA_FILE), `${JSON.stringify(metadata, null, 2)}\n`),
  ]);
  return metadata;
}

async function createWorkerTemplate(root: string): Promise<string> {
  const template = await fs.readFile(resolve(root, "public/sw.js"), "utf8");
  const markerCount = template.split(OUTBOX_ACCEPTANCE_MARKER).length - 1;
  if (markerCount !== 1) {
    throw new Error(
      `The service-worker template must contain exactly one outbox acceptance marker; found ${markerCount}.`,
    );
  }

  const kernelPath = resolve(root, "src/modules/sync/outbox-acceptance.ts");
  const kernelSource = await fs.readFile(kernelPath, "utf8");
  const { code: transformedKernel } = await transformWithOxc(kernelSource, kernelPath, {
    lang: "ts",
  });
  const kernel = transformedKernel
    .replace(/^export\s+(?=(?:async\s+)?(?:function|class|const|let|var)\b)/gm, "")
    .replace(/^export\s*\{[^}]*\};?\s*$/gm, "");
  const standaloneKernel = `const __outboxAcceptanceKernel = (() => {\n${kernel}\nreturn { drainOutbox };\n})();`;
  return template.replace(OUTBOX_ACCEPTANCE_MARKER, standaloneKernel);
}

async function listRuntimeAssets(outDir: string): Promise<RuntimeAsset[]> {
  const files = (await walkFiles(outDir))
    .filter((file) => !file.endsWith(".map"))
    .filter((file) => file !== "sw.js" && file !== "_shell.html")
    .filter((file) => file !== "_redirects" && file !== ARTIFACT_METADATA_FILE)
    .toSorted();
  return Promise.all(
    files.map(async (file) => ({
      url: `/${file}`,
      content: await fs.readFile(resolve(outDir, file)),
    })),
  );
}

async function walkFiles(directory: string, prefix = ""): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) return walkFiles(resolve(directory, entry.name), relativePath);
      return [relativePath];
    }),
  );
  return files.flat();
}

async function verifyPrecache(outDir: string, precache: readonly string[]): Promise<void> {
  await Promise.all(
    precache.map(async (url) => {
      const relativePath =
        url === "/" ? "index.html" : url.slice(1) + (url.endsWith("/") ? "index.html" : "");
      try {
        await fs.access(resolve(outDir, relativePath));
      } catch (error) {
        throw new Error(`Precache asset ${url} is missing from ${outDir}.`, { cause: error });
      }
    }),
  );
}

function createRedirects(shellUrl: string): string {
  return `${uiRewritePaths()
    .map((path) => `${path} ${shellUrl} 200`)
    .join("\n")}\n`;
}

async function readArtifactMetadata(
  root: string,
  outDir: string,
): Promise<ArtifactMetadata | null> {
  try {
    const source = await fs.readFile(
      resolve(root, outDir, "client", ARTIFACT_METADATA_FILE),
      "utf8",
    );
    return JSON.parse(source) as ArtifactMetadata;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
