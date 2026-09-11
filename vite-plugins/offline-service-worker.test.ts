import { promises as fs } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Script, createContext } from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import { offlineServiceWorker } from "./offline-service-worker";
import type { ResolvedConfig } from "vite";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

async function generateWorker(): Promise<string> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "transactions-tracker-worker-"));
  temporaryDirectories.push(temporaryRoot);
  const outputDirectory = join(temporaryRoot, "client");
  await fs.mkdir(outputDirectory);

  const plugin = offlineServiceWorker();
  if (typeof plugin.configResolved !== "function" || typeof plugin.writeBundle !== "function") {
    throw new Error("The offline service-worker plugin is missing its build hooks.");
  }

  Reflect.apply(plugin.configResolved, undefined, [
    { root: process.cwd(), build: { outDir: "dist" } } as ResolvedConfig,
  ]);
  await Reflect.apply(plugin.writeBundle, undefined, [{ dir: outputDirectory }, {}]);

  return fs.readFile(join(outputDirectory, "sw.js"), "utf8");
}

describe("offlineServiceWorker", () => {
  it("inlines the portable acceptance kernel without module syntax or placeholders", async () => {
    const worker = await generateWorker();

    expect(worker).toContain("__outboxAcceptanceKernel");
    expect(worker).toContain("The server confirmed none of the pushed changes.");
    expect(worker).toContain('const DATABASE_NAME = "transactions-tracker";');
    expect(worker).toContain("const DATABASE_VERSION = 3;");
    expect(worker).not.toMatch(/__[A-Z][A-Z0-9_]*__/);
    expect(worker).not.toMatch(/(?:^|\n)\s*(?:import|export)\s/m);
  });

  it("emits a classic script with an available kernel and safe event handlers", async () => {
    const worker = await generateWorker();
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
    expect(listeners).toEqual(["install", "activate", "fetch"]);
    expect(worker).not.toContain('fetch("/api/push"');
    expect(worker).not.toContain("indexedDB.open");
  });
});
