import { describe, expect, it } from "vitest";
import { getSignInReturnPath } from "./complete-sign-in";

function location(search: string): Location {
  return { origin: "https://tracker.example", search } as Location;
}

describe("getSignInReturnPath", () => {
  it("keeps a same-origin UI path with its search and hash", () => {
    expect(
      getSignInReturnPath(location("?returnTo=%2Ftransactions%3Faccount%3Dchecking%23latest")),
    ).toBe("/transactions?account=checking#latest");
  });

  it.each([
    "https://evil.example/",
    "//evil.example/",
    "/login?returnTo=/settings",
    "javascript:x",
  ])("rejects unsafe destination %s", (returnTo) => {
    expect(getSignInReturnPath(location(`?returnTo=${encodeURIComponent(returnTo)}`))).toBe("/");
  });
});
