import { promises as fs } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Script, createContext } from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import { finalizeOfflineArtifacts } from "./offline-service-worker";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

async function finalizeWorker() {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "transactions-tracker-worker-"));
  temporaryDirectories.push(temporaryRoot);
  const outputDirectory = join(temporaryRoot, "client");
  await fs.mkdir(join(outputDirectory, "assets"), { recursive: true });
  await fs.writeFile(
    join(outputDirectory, "_shell.html"),
    '<!doctype html><html><head><link href="/assets/app.css"></head><body><div id="root"></div></body></html>',
  );
  await fs.writeFile(join(outputDirectory, "assets", "app.css"), "body{}");
  await fs.writeFile(join(outputDirectory, "assets", "lazy-route.js"), "export {};");
  await fs.writeFile(join(outputDirectory, "assets", "lazy-route.js.map"), "{}");

  const metadata = await finalizeOfflineArtifacts(process.cwd(), outputDirectory);
  return {
    outputDirectory,
    metadata,
    worker: await fs.readFile(join(outputDirectory, "sw.js"), "utf8"),
  };
}

describe("offlineServiceWorker", () => {
  it("finalizes a prerendered shell into deterministic, complete offline artifacts", async () => {
    const first = await finalizeWorker();
    const second = await finalizeWorker();

    expect(first.metadata.buildId).toBe(second.metadata.buildId);
    expect(first.metadata.shellUrl).toBe(`/_shell/${first.metadata.buildId}/`);
    expect(first.metadata.precache).toContain(first.metadata.shellUrl);
    expect(first.metadata.precache).toContain("/assets/app.css");
    expect(first.metadata.precache).toContain("/assets/lazy-route.js");
    expect(first.metadata.precache).not.toContain("/assets/lazy-route.js.map");
    await expect(
      fs.readFile(
        join(first.outputDirectory, "_shell", first.metadata.buildId, "index.html"),
        "utf8",
      ),
    ).resolves.toContain('<div id="root"></div>');
    const redirects = await fs.readFile(join(first.outputDirectory, "_redirects"), "utf8");
    expect(redirects).not.toContain(`/api/push ${first.metadata.shellUrl} 200`);
    expect(redirects).toContain(`/transactions/ ${first.metadata.shellUrl} 200`);
  });

  it("inlines the portable acceptance kernel without module syntax or placeholders", async () => {
    const { worker } = await finalizeWorker();

    expect(worker).toContain("__outboxAcceptanceKernel");
    expect(worker).toContain("The server confirmed none of the pushed changes.");
    expect(worker).toContain('const DATABASE_NAME = "transactions-tracker";');
    expect(worker).toContain("const DATABASE_VERSION = 3;");
    expect(worker).not.toMatch(/__[A-Z][A-Z0-9_]*__/);
    expect(worker).not.toMatch(/(?:^|\n)\s*(?:import|export)\s/m);
  });

  it("emits a classic script with an available kernel and safe event handlers", async () => {
    const { worker } = await finalizeWorker();
    const listeners: string[] = [];
    const context = createContext({
      URL,
      fetch: () => Promise.reject(new Error("Network is unavailable in the parse smoke test.")),
      indexedDB: {},
      navigator: {},
      caches: {},
      self: {
        location: { origin: "https://example.test" },
        addEventListener: (type: string) => listeners.push(type),
        skipWaiting: () => undefined,
      },
    });

    expect(() => new Script(worker, { filename: "sw.js" }).runInContext(context)).not.toThrow();
    expect(
      new Script("__outboxAcceptanceKernel.drainOutbox", {
        filename: "kernel-check.js",
      }).runInContext(context),
    ).toBeTypeOf("function");
    expect(listeners).toEqual(["install", "activate", "message", "fetch"]);
    expect(worker).not.toContain("skipWaiting");
    expect(worker).not.toContain("clients.claim");
    expect(worker).not.toContain('fetch("/api/push"');
    expect(worker).not.toContain("indexedDB.open");
  });

  it("serves only its versioned shell for allowlisted navigations and retains live client caches", async () => {
    const { worker, metadata } = await finalizeWorker();

    expect(worker).toContain("event.respondWith(getCachedShell())");
    expect(worker).not.toContain("cache.addAll(PRECACHE)");
    expect(worker).toContain('credentials: url === SHELL_URL ? "omit" : "same-origin"');
    expect(worker).toContain('redirect: "error"');
    expect(worker).toContain('fetch(SHELL_URL, { credentials: "omit", redirect: "error" })');
    expect(worker).toContain("OFFLINE_RECOVERY_HTML");
    expect(worker).not.toContain("caches.match(SHELL_URL)");
    expect(worker).toContain("const exactUrl = `${url.pathname}${url.search}`");
    expect(worker).toContain("match(request, { ignoreVary: true })");
    expect(worker).toContain("includeUncontrolled: true");
    expect(worker).toContain("request-client-build-id");
    expect(worker).toMatch(/if\s*\(\s*replies\.size !== clients\.length/);
    expect(worker).toContain(`const SHELL_URL = "${metadata.shellUrl}";`);
  });
});
