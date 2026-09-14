import { expect, test } from "@playwright/test";
import {
  startWorkerUpdateHarness,
  type FaultMode,
  type WorkerUpdateHarness,
} from "./worker-update-harness";
import type { BrowserContext, Page } from "@playwright/test";

const CACHE_PREFIX = "transactions-tracker-";
const MESSAGE_TYPE = "transactions-tracker:service-worker";

type WorkerSnapshot = {
  controllerBuildId: string | null;
  waitingBuildId: string | null;
  installingState: string | null;
  cacheNames: string[];
  completeBuilds: string[];
};

test("P19: a complete B waits without reloading dirty A clients or evicting A assets", async ({
  browser,
}) => {
  const harness = await startWorkerUpdateHarness();
  const context = await browser.newContext();

  try {
    const first = await openControlledPage(context, harness, "first-dirty-value");
    const second = await openControlledPage(context, harness, "second-dirty-value");
    const firstToken = await installPageSentinel(first);
    const secondToken = await installPageSentinel(second);

    harness.deploy("B");
    await requestWorkerUpdate(first);
    await expect
      .poll(() => workerSnapshot(first, harness), { message: "build B should finish and wait" })
      .toMatchObject({
        controllerBuildId: harness.releaseA.buildId,
        waitingBuildId: harness.releaseB.buildId,
        installingState: null,
        completeBuilds: expect.arrayContaining([
          harness.releaseA.buildId,
          harness.releaseB.buildId,
        ]),
      });

    await assertDirtyClientStayedOnA(first, "first-dirty-value", firstToken, harness);
    await assertDirtyClientStayedOnA(second, "second-dirty-value", secondToken, harness);

    harness.deploy("B", { mode: "missing", url: harness.releaseAAssetUrl });
    const cachedAsset = await first.evaluate(async (url) => {
      const response = await fetch(url, { cache: "reload" });
      return {
        ok: response.ok,
        release: response.headers.get("x-pwa-harness-release"),
      };
    }, harness.releaseAAssetUrl);
    expect(cachedAsset).toEqual({ ok: true, release: "A" });
    expect(harness.faultHits(), "A's controlling worker should satisfy the request locally").toBe(
      0,
    );

    const whileClientsAreOpen = await workerSnapshot(first, harness);
    expect(whileClientsAreOpen.cacheNames).toContain(`${CACHE_PREFIX}${harness.releaseA.buildId}`);

    await Promise.all([first.close(), second.close()]);
    const reopened = await context.newPage();
    await reopened.goto(`${harness.origin}/login`);
    await expect(reopened.getByRole("heading", { name: "Welcome", exact: true })).toBeVisible();
    await expect
      .poll(() => readWorkerBuildId(reopened, "controller"), {
        message: "B should control the first window opened after all A clients close",
      })
      .toBe(harness.releaseB.buildId);
    await expect(reopened.locator('meta[name="pwa-harness-build"]')).toHaveAttribute(
      "content",
      harness.releaseB.buildId,
    );
  } finally {
    await context.close();
    await harness.close();
  }
});

const failedInstallCases: Array<{
  title: string;
  mode: FaultMode;
  faultUrl(harness: WorkerUpdateHarness): string;
}> = [
  {
    title: "missing runtime asset",
    mode: "missing",
    faultUrl: (harness) => harness.releaseBAssetUrl,
  },
  {
    title: "interrupted runtime asset",
    mode: "interrupt",
    faultUrl: (harness) => harness.releaseBAssetUrl,
  },
  {
    title: "redirected versioned shell",
    mode: "redirect",
    faultUrl: (harness) => harness.releaseB.shellUrl,
  },
];

for (const failureCase of failedInstallCases) {
  test(`P20: ${failureCase.title} cannot become a complete B cache`, async ({ browser }) => {
    const harness = await startWorkerUpdateHarness();
    const context = await browser.newContext();

    try {
      const page = await openControlledPage(context, harness, "A-remains-usable");
      harness.deploy("B", {
        mode: failureCase.mode,
        url: failureCase.faultUrl(harness),
      });
      await requestWorkerUpdate(page);
      await expect
        .poll(() => harness.faultHits(), {
          message: `${failureCase.title} fault should be exercised`,
        })
        .toBeGreaterThan(0);

      await page.reload();
      await expect(page.getByRole("heading", { name: "Welcome", exact: true })).toBeVisible();
      await expect
        .poll(() => readWorkerBuildId(page, "controller"), {
          message: "the working A worker should remain in control",
        })
        .toBe(harness.releaseA.buildId);
      await expect(page.locator('meta[name="pwa-harness-build"]')).toHaveAttribute(
        "content",
        harness.releaseA.buildId,
      );

      await expect
        .poll(() => workerSnapshot(page, harness), {
          message: "failed B must be redundant and must not leave complete cache metadata",
        })
        .toMatchObject({
          controllerBuildId: harness.releaseA.buildId,
          waitingBuildId: null,
          installingState: null,
          cacheNames: [expect.not.stringContaining(harness.releaseB.buildId)],
          completeBuilds: [expect.not.stringContaining(harness.releaseB.buildId)],
        });
    } finally {
      await context.close();
      await harness.close();
    }
  });
}

async function openControlledPage(
  context: BrowserContext,
  harness: WorkerUpdateHarness,
  dirtyValue: string,
): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${harness.origin}/login`);
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
  });
  if (!(await page.evaluate(() => navigator.serviceWorker.controller != null))) await page.reload();

  await expect(page.getByRole("heading", { name: "Welcome", exact: true })).toBeVisible();
  await expect
    .poll(() => readWorkerBuildId(page, "controller"), {
      message: "build A should control the test page",
    })
    .toBe(harness.releaseA.buildId);
  await expect(page.locator('meta[name="pwa-harness-build"]')).toHaveAttribute(
    "content",
    harness.releaseA.buildId,
  );
  await expect(page.getByTestId("password-auth-username")).toBeEnabled();
  await page.getByTestId("password-auth-username").fill(dirtyValue);
  return page;
}

async function installPageSentinel(page: Page): Promise<string> {
  return page.evaluate(() => {
    const token = crypto.randomUUID();
    (window as Window & { pwaHarnessPageToken?: string }).pwaHarnessPageToken = token;
    return token;
  });
}

async function assertDirtyClientStayedOnA(
  page: Page,
  dirtyValue: string,
  token: string,
  harness: WorkerUpdateHarness,
): Promise<void> {
  expect(
    await page.evaluate(
      () => (window as Window & { pwaHarnessPageToken?: string }).pwaHarnessPageToken,
    ),
  ).toBe(token);
  await expect(page.getByTestId("password-auth-username")).toHaveValue(dirtyValue);
  await expect(page.locator('meta[name="pwa-harness-build"]')).toHaveAttribute(
    "content",
    harness.releaseA.buildId,
  );
  expect(await readWorkerBuildId(page, "controller")).toBe(harness.releaseA.buildId);
}

async function requestWorkerUpdate(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) throw new Error("No service-worker registration exists for the harness.");
    await registration.update();
  });
}

async function workerSnapshot(page: Page, harness: WorkerUpdateHarness): Promise<WorkerSnapshot> {
  const lifecycle = await page.evaluate(async (messageType) => {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) throw new Error("No service-worker registration exists for the harness.");

    const readBuildId = (worker: ServiceWorker | null): Promise<string | null> => {
      if (!worker) return Promise.resolve(null);
      return new Promise((resolvePromise, reject) => {
        const timeout = window.setTimeout(
          () => reject(new Error(`Timed out reading worker ${worker.state} build id.`)),
          2_000,
        );
        const onMessage = (event: MessageEvent) => {
          if (event.data?.type !== messageType || event.data.action !== "build-id") return;
          window.clearTimeout(timeout);
          navigator.serviceWorker.removeEventListener("message", onMessage);
          resolvePromise(typeof event.data.buildId === "string" ? event.data.buildId : null);
        };
        navigator.serviceWorker.addEventListener("message", onMessage);
        // oxlint-disable-next-line unicorn/require-post-message-target-origin -- ServiceWorker.postMessage has no targetOrigin parameter.
        worker.postMessage({ type: messageType, action: "get-build-id" });
      });
    };

    return {
      controllerBuildId: await readBuildId(navigator.serviceWorker.controller),
      waitingBuildId: await readBuildId(registration.waiting),
      installingState: registration.installing?.state ?? null,
      cacheNames: await caches.keys(),
    };
  }, MESSAGE_TYPE);

  const completeBuilds = await page.evaluate(
    async ({ buildIds, cachePrefix }) => {
      const cacheNames = await caches.keys();
      const complete = await Promise.all(
        buildIds.map(async (buildId) => {
          const cacheName = `${cachePrefix}${buildId}`;
          if (!cacheNames.includes(cacheName)) return null;
          const cache = await caches.open(cacheName);
          const metadata = await cache.match(`/_offline-cache/${buildId}`);
          return metadata ? buildId : null;
        }),
      );
      return complete.filter((buildId): buildId is string => buildId != null);
    },
    {
      buildIds: [harness.releaseA.buildId, harness.releaseB.buildId],
      cachePrefix: CACHE_PREFIX,
    },
  );

  return { ...lifecycle, completeBuilds };
}

async function readWorkerBuildId(
  page: Page,
  target: "controller" | "waiting",
): Promise<string | null> {
  return page.evaluate(
    async ({ messageType, workerTarget }) => {
      const registration = await navigator.serviceWorker.getRegistration();
      const worker =
        workerTarget === "controller" ? navigator.serviceWorker.controller : registration?.waiting;
      if (!worker) return null;

      return new Promise<string | null>((resolvePromise, reject) => {
        const timeout = window.setTimeout(
          () => reject(new Error(`Timed out reading ${workerTarget} worker build id.`)),
          2_000,
        );
        const onMessage = (event: MessageEvent) => {
          if (event.data?.type !== messageType || event.data.action !== "build-id") return;
          window.clearTimeout(timeout);
          navigator.serviceWorker.removeEventListener("message", onMessage);
          resolvePromise(typeof event.data.buildId === "string" ? event.data.buildId : null);
        };
        navigator.serviceWorker.addEventListener("message", onMessage);
        // oxlint-disable-next-line unicorn/require-post-message-target-origin -- ServiceWorker.postMessage has no targetOrigin parameter.
        worker.postMessage({ type: messageType, action: "get-build-id" });
      });
    },
    { messageType: MESSAGE_TYPE, workerTarget: target },
  );
}
