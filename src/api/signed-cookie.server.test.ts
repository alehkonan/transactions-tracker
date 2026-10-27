import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signCookieValue, verifyCookieValue } from "./signed-cookie.server";

describe("dataset-bound signed cookies", () => {
  const secret = "test-secret-used-by-both-datasets";
  const payload = { sessionId: 1, userId: 1, username: "new-user", expiresAt: Date.now() + 60_000 };

  beforeEach(() => vi.stubEnv("AUTH_SECRET", secret));
  afterEach(() => vi.unstubAllEnvs());

  it("rejects an old dataset cookie even when the secret and serial IDs are reused", () => {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const legacySignature = createHmac("sha256", secret).update(body).digest("base64url");

    expect(verifyCookieValue(`${body}.${legacySignature}`)).toBeNull();
    expect(verifyCookieValue(signCookieValue(payload))).toEqual(payload);
  });
});
