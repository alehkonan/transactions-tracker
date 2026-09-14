import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, resolve, sep } from "node:path";

const PUBLIC_ROOT = resolve(process.cwd(), "dist", "client");
const BUILD_ID_PATTERN = /^[a-f\d]{20}$/;

export type ReleaseName = "A" | "B";
export type FaultMode = "interrupt" | "missing" | "redirect";

type ArtifactMetadata = {
  buildId: string;
  shellUrl: string;
  precache: string[];
  uiPaths: string[];
};

type Release = ArtifactMetadata & {
  name: ReleaseName;
  shell: Buffer;
  worker: Buffer;
};

type Fault = {
  mode: FaultMode;
  url: string;
};

type Resource = {
  body: Buffer;
  contentType: string;
  cacheControl: string;
};

export type WorkerUpdateHarness = {
  origin: string;
  releaseA: Release;
  releaseB: Release;
  releaseAAssetUrl: string;
  releaseBAssetUrl: string;
  deploy(release: ReleaseName, fault?: Fault): void;
  faultHits(): number;
  close(): Promise<void>;
};

export async function startWorkerUpdateHarness(): Promise<WorkerUpdateHarness> {
  const metadata = JSON.parse(
    await fs.readFile(resolve(PUBLIC_ROOT, "offline-artifacts.json"), "utf8"),
  ) as ArtifactMetadata;
  if (!BUILD_ID_PATTERN.test(metadata.buildId)) {
    throw new Error(`Built offline metadata has an invalid build id: ${metadata.buildId}`);
  }

  const [builtWorker, builtShell] = await Promise.all([
    fs.readFile(resolve(PUBLIC_ROOT, "sw.js"), "utf8"),
    readPublicFile(metadata.shellUrl),
  ]);
  const builtAssetUrl =
    metadata.precache.find((url) => url.startsWith("/assets/") && url.endsWith(".js")) ??
    metadata.precache.find((url) => url.startsWith("/assets/"));
  if (!builtAssetUrl) throw new Error("The built precache has no faultable runtime asset.");
  const releaseA = createRelease("A", metadata, builtWorker, builtShell, builtAssetUrl);
  const releaseB = createRelease("B", metadata, builtWorker, builtShell, builtAssetUrl);
  const releases = [releaseA, releaseB];
  const releaseAAssetUrl = releaseA.precache.find((url) => url.startsWith(builtAssetUrl));
  const releaseBAssetUrl = releaseB.precache.find((url) => url.startsWith(builtAssetUrl));
  if (!releaseAAssetUrl || !releaseBAssetUrl) {
    throw new Error("The A/B releases lost the selected runtime asset.");
  }

  let deployed = releaseA;
  let fault: Fault | undefined;
  let currentFaultHits = 0;

  const server = createServer((request, response) => {
    void (async () => {
      if (request.method !== "GET" || !request.url) {
        response.writeHead(404).end();
        return;
      }

      const requestUrl = new URL(request.url, "http://pwa-harness.local");
      const pathname = requestUrl.pathname;
      const requestTarget = `${pathname}${requestUrl.search}`;
      if (fault?.url === requestTarget) {
        currentFaultHits += 1;
        if (fault.mode === "missing") {
          response.writeHead(404, { "Cache-Control": "no-store" }).end("missing by harness");
          return;
        }
        if (fault.mode === "redirect") {
          response.writeHead(302, { "Cache-Control": "no-store", Location: "/login" }).end();
          return;
        }
      }

      const resource = await resolveResource(pathname, deployed, releases);
      if (!resource) {
        response.writeHead(404, { "Cache-Control": "no-store" }).end("not found");
        return;
      }

      const headers = {
        "Cache-Control": resource.cacheControl,
        "Content-Length": String(resource.body.byteLength),
        "Content-Type": resource.contentType,
        "X-PWA-Harness-Release": deployed.name,
      };
      if (fault?.url === requestTarget && fault.mode === "interrupt") {
        response.writeHead(200, headers);
        response.write(
          resource.body.subarray(0, Math.max(1, Math.floor(resource.body.length / 2))),
        );
        response.socket?.destroy();
        return;
      }

      response.writeHead(200, headers).end(resource.body);
    })().catch((error: unknown) => {
      if (response.destroyed) return;
      response
        .writeHead(500, { "Content-Type": "text/plain" })
        .end(error instanceof Error ? error.message : "PWA harness failure");
    });
  });

  await listen(server);
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("PWA harness did not bind a TCP port.");

  return {
    origin: `http://127.0.0.1:${address.port}`,
    releaseA,
    releaseB,
    releaseAAssetUrl,
    releaseBAssetUrl,
    deploy(release, nextFault) {
      deployed = release === "A" ? releaseA : releaseB;
      fault = nextFault;
      currentFaultHits = 0;
    },
    faultHits: () => currentFaultHits,
    close: () => closeServer(server),
  };
}

function createRelease(
  name: ReleaseName,
  metadata: ArtifactMetadata,
  builtWorker: string,
  builtShell: Buffer,
  builtAssetUrl: string,
): Release {
  const buildId = createHash("sha256")
    .update(`pwa-worker-update-harness:${metadata.buildId}:${name}`)
    .digest("hex")
    .slice(0, 20);
  const replaceBuildId = (value: string) => value.replaceAll(metadata.buildId, buildId);
  const shellUrl = replaceBuildId(metadata.shellUrl);
  const originalPrecache = metadata.precache.map(replaceBuildId);
  const precache = [...originalPrecache];
  if (name === "B") {
    const assetIndex = precache.indexOf(replaceBuildId(builtAssetUrl));
    if (assetIndex < 0) throw new Error(`Build B cannot version missing asset ${builtAssetUrl}.`);
    precache[assetIndex] = `${precache[assetIndex]}?pwa-harness-build=${buildId}`;
  }
  const versionedWorker = replaceBuildId(builtWorker);
  const worker = versionedWorker.replace(
    `const PRECACHE = ${JSON.stringify(originalPrecache)};`,
    `const PRECACHE = ${JSON.stringify(precache)};`,
  );
  if (worker === versionedWorker && name === "B") {
    throw new Error("Could not stamp build B's deterministic runtime-asset URL into the worker.");
  }
  const shellMarker = `<meta name="pwa-harness-build" content="${buildId}">`;
  const shell = Buffer.from(
    builtShell.toString("utf8").replace(/<head([^>]*)>/i, `<head$1>${shellMarker}`),
  );

  return {
    name,
    buildId,
    shellUrl,
    shell,
    worker: Buffer.from(worker),
    precache,
    uiPaths: metadata.uiPaths,
  };
}

async function resolveResource(
  pathname: string,
  deployed: Release,
  releases: Release[],
): Promise<Resource | null> {
  if (pathname === "/sw.js") {
    return {
      body: deployed.worker,
      contentType: "text/javascript; charset=utf-8",
      cacheControl: "no-store",
    };
  }
  if (pathname === "/offline-artifacts.json") {
    return {
      body: Buffer.from(
        JSON.stringify({
          buildId: deployed.buildId,
          shellUrl: deployed.shellUrl,
          precache: deployed.precache,
          uiPaths: deployed.uiPaths,
        }),
      ),
      contentType: "application/json; charset=utf-8",
      cacheControl: "no-store",
    };
  }

  const versionedShell = releases.find((release) => release.shellUrl === pathname);
  const uiPath = pathname.endsWith("/") && pathname !== "/" ? pathname.slice(0, -1) : pathname;
  if (versionedShell || deployed.uiPaths.includes(uiPath)) {
    return {
      body: versionedShell?.shell ?? deployed.shell,
      contentType: "text/html; charset=utf-8",
      cacheControl: versionedShell ? "public, immutable, max-age=31536000" : "no-cache",
    };
  }

  try {
    const body = await readPublicFile(pathname);
    return {
      body,
      contentType: contentType(pathname),
      cacheControl: "public, immutable, max-age=31536000",
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function readPublicFile(urlPath: string): Promise<Buffer> {
  const relativePath = urlPath.slice(1) + (urlPath.endsWith("/") ? "index.html" : "");
  const filePath = resolve(PUBLIC_ROOT, relativePath);
  if (filePath !== PUBLIC_ROOT && !filePath.startsWith(`${PUBLIC_ROOT}${sep}`)) {
    throw new Error(`Refusing to serve path outside built public output: ${urlPath}`);
  }
  return fs.readFile(filePath);
}

function contentType(pathname: string): string {
  switch (extname(pathname)) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
    case ".webmanifest":
      return "application/json; charset=utf-8";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}

function listen(server: Server): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolvePromise();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolvePromise();
    });
  });
}
