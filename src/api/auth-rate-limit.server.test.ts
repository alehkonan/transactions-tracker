import { describe, expect, it, vi } from "vitest";
import {
  AUTH_RATE_LIMITS,
  authRateLimitResponse,
  createAuthRateLimiter,
  digestAuthRateLimitKey,
} from "./auth-rate-limit.server";

describe("auth rate limit helpers", () => {
  it("HMACs identifiers without storing the source value", () => {
    const digest = digestAuthRateLimitKey("person@example.com", "test-secret");

    expect(digest).not.toContain("person@example.com");
    expect(digest).toBe(digestAuthRateLimitKey("person@example.com", "test-secret"));
    expect(digest).not.toBe(digestAuthRateLimitKey("person@example.com", "other-secret"));
  });

  it("applies address then username sign-in limits with the required policies", async () => {
    const consumeAttempt = vi.fn(async () => null);
    const limiter = createAuthRateLimiter({
      consumeAttempt,
      digestKey: (identifier) => `digest:${identifier}`,
      now: () => new Date("2026-09-01T12:00:00Z"),
    });

    await limiter.enforceSignIn({ username: "alice", address: "trusted-address" });

    expect(consumeAttempt).toHaveBeenNthCalledWith(1, {
      ...AUTH_RATE_LIMITS.signInAddress,
      keyDigest: "digest:trusted-address",
      now: new Date("2026-09-01T12:00:00Z"),
    });
    expect(consumeAttempt).toHaveBeenNthCalledWith(2, {
      ...AUTH_RATE_LIMITS.signInUsername,
      keyDigest: "digest:alice",
      now: new Date("2026-09-01T12:00:00Z"),
    });
  });

  it("does not invent an address when trusted input is absent", async () => {
    const consumeAttempt = vi.fn(async () => null);
    const limiter = createAuthRateLimiter({
      consumeAttempt,
      digestKey: (identifier) => identifier,
    });

    await limiter.enforceRegistration({});
    await limiter.enforceSignIn({ username: "alice" });

    expect(consumeAttempt).toHaveBeenCalledTimes(1);
    expect(consumeAttempt).toHaveBeenCalledWith(
      expect.objectContaining(AUTH_RATE_LIMITS.signInUsername),
    );
  });

  it("throws a generic 429 with Retry-After", async () => {
    const limiter = createAuthRateLimiter({
      consumeAttempt: async () => ({ retryAfterSeconds: 12.2 }),
      digestKey: (identifier) => identifier,
    });

    let response: Response | undefined;
    try {
      await limiter.enforceRegistration({ address: "trusted-address" });
    } catch (error) {
      response = error as Response;
    }

    expect(response?.status).toBe(429);
    expect(response?.headers.get("Retry-After")).toBe("13");
    await expect(response?.json()).resolves.toEqual({
      error: "Too many authentication attempts. Please try again later.",
    });
  });

  it("clamps Retry-After to at least one second", () => {
    expect(authRateLimitResponse(0).headers.get("Retry-After")).toBe("1");
  });
});
