import { promises as fs } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { offlineServiceWorker } from "./offline-service-worker";
import type { ResolvedConfig } from "vite";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("offlineServiceWorker", () => {
  it("inlines the portable acceptance kernel without application imports", async () => {
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

    const worker = await fs.readFile(join(outputDirectory, "sw.js"), "utf8");
    expect(worker).toContain("__outboxAcceptanceKernel");
    expect(worker).toContain("The server confirmed none of the pushed changes.");
    expect(worker).not.toContain("__OUTBOX_ACCEPTANCE_KERNEL__");
    expect(worker).not.toMatch(/(?:^|\n)\s*import\s/);
  });
});
