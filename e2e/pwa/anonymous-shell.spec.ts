import { expect, test } from "@playwright/test";
import type { Browser } from "@playwright/test";

const identities = [
  {
    username: "P21_USERNAME_ALPHA_DO_NOT_LEAK",
    profileHint: "P21_PROFILE_ALPHA_DO_NOT_LEAK",
    financialMarker: "P21_BALANCE_ALPHA_91827364_DO_NOT_LEAK",
    redirectMarker: "P21_AUTH_REDIRECT_ALPHA_DO_NOT_LEAK",
  },
  {
    username: "P21_USERNAME_BRAVO_DO_NOT_LEAK",
    profileHint: "P21_PROFILE_BRAVO_DO_NOT_LEAK",
    financialMarker: "P21_BALANCE_BRAVO_56473829_DO_NOT_LEAK",
    redirectMarker: "P21_AUTH_REDIRECT_BRAVO_DO_NOT_LEAK",
  },
] as const;

async function requestAnonymousShell(
  browser: Browser,
  baseURL: string,
  identity: (typeof identities)[number],
): Promise<Buffer> {
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false });
  const returnTo = `/transactions?account=${identity.financialMarker}#${identity.redirectMarker}`;

  try {
    await context.addCookies([
      {
        name: "session_hint",
        value: encodeURIComponent(
          JSON.stringify({
            exp: Date.UTC(2100, 0, 1),
            username: identity.username,
            financialMarker: identity.financialMarker,
            returnTo,
          }),
        ),
        url: baseURL,
      },
      { name: "profile_hint", value: identity.profileHint, url: baseURL },
      { name: "access_token", value: `forged-${identity.username}`, url: baseURL },
      { name: "refresh_token", value: `forged-${identity.financialMarker}`, url: baseURL },
      {
        name: "selected_profile",
        value: `forged-${identity.profileHint}`,
        url: baseURL,
      },
    ]);

    const page = await context.newPage();
    const target = "/transactions";
    const response = await page.goto(target, { waitUntil: "domcontentloaded" });

    expect(response, "production preview should return the anonymous document").not.toBeNull();
    if (!response) throw new Error("Production preview returned no document response.");

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/html");
    expect(
      response.request().redirectedFrom(),
      "the shell request must not auth-redirect",
    ).toBeNull();
    expect(page.url()).toBe(new URL(target, baseURL).href);

    const cookieHeader = (await response.request().allHeaders()).cookie ?? "";
    expect(cookieHeader).toContain(identity.username);
    expect(cookieHeader).toContain(identity.profileHint);
    expect(cookieHeader).toContain(identity.financialMarker);
    expect(cookieHeader).toContain(identity.redirectMarker);

    return await response.body();
  } finally {
    await context.close();
  }
}

test("P21: anonymous production HTML is byte-identical across forged identities", async ({
  baseURL,
  browser,
}) => {
  if (!baseURL) throw new Error("The shared Playwright config must provide a production baseURL.");

  const shells = await Promise.all(
    identities.map((identity) => requestAnonymousShell(browser, baseURL, identity)),
  );

  expect(shells[0].equals(shells[1]), "anonymous shell response bytes must match exactly").toBe(
    true,
  );

  for (const shell of shells) {
    const html = shell.toString("utf8");
    for (const identity of identities) {
      expect(html).not.toContain(identity.username);
      expect(html).not.toContain(identity.profileHint);
      expect(html).not.toContain(identity.financialMarker);
      expect(html).not.toContain(identity.redirectMarker);
    }
  }
});
