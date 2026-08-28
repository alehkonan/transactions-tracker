import { expect } from "@playwright/test";
import { test, waitForSynced } from "./fixtures/auth";

test("the HTTP push route returns the shared result shape", async ({ onboardedPage: page }) => {
  await page.goto("/transactions");
  await waitForSynced(page);

  const result = await page.evaluate(async () => {
    const response = await fetch("/api/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mutations: [] }),
    });

    return {
      status: response.status,
      body: (await response.json()) as {
        applied: unknown[];
        canonicalRows: Record<string, unknown[]>;
        conflicts: unknown[];
        colors: unknown[];
      },
    };
  });

  expect(result.status).toBe(200);
  expect(result.body).toEqual({
    applied: [],
    canonicalRows: {
      profiles: [],
      accounts: [],
      categories: [],
      transactions: [],
    },
    conflicts: [],
    colors: expect.any(Array),
  });
});
