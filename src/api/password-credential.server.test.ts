import { describe, expect, it } from "vitest";
import { hashPassword, isPasswordAllowed, verifyPassword } from "./password-credential.server";

describe("password credential helpers", () => {
  it("enforces 12-128 code points without trimming or normalization", () => {
    expect(isPasswordAllowed("12345678901")).toBe(false);
    expect(isPasswordAllowed("123456789012")).toBe(true);
    expect(isPasswordAllowed(" ".repeat(12))).toBe(true);
    expect(isPasswordAllowed("🔐".repeat(128))).toBe(true);
    expect(isPasswordAllowed("🔐".repeat(129))).toBe(false);
  });

  it("creates salted versioned hashes and verifies the exact password", async () => {
    const password = "  exact password  ";
    const first = await hashPassword(password);
    const second = await hashPassword(password);

    expect(first).toMatch(/^scrypt\$v=1\$N=16384,r=8,p=1\$/);
    expect(second).not.toBe(first);
    await expect(verifyPassword(password, first)).resolves.toBe(true);
    await expect(verifyPassword(password.trim(), first)).resolves.toBe(false);
  });

  it("performs dummy verification for missing or malformed credentials", async () => {
    await expect(verifyPassword("does not matter", null)).resolves.toBe(false);
    await expect(verifyPassword("does not matter", "not-a-password-hash")).resolves.toBe(false);
  });
});
