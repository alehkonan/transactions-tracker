import { describe, expect, it } from "vitest";
import { getPasswordAuthErrorMessage } from "~/modules/auth/password-auth-errors";

describe("getPasswordAuthErrorMessage", () => {
  it("replaces leaked password-credential queries with an actionable setup message", () => {
    const leaked = new Error(
      'Failed query: insert into "password_credentials" ("user_id", "password_hash") values ($1, $2) params: 47,<REDACTED>',
    );

    expect(getPasswordAuthErrorMessage("sign-up", leaked)).toBe(
      "Account creation is temporarily unavailable because the server database needs an update. Please contact the administrator.",
    );
  });

  it("preserves safe, intentional registration errors", () => {
    expect(
      getPasswordAuthErrorMessage("sign-up", new Error("That username is already taken.")),
    ).toBe("That username is already taken.");
  });

  it("keeps sign-in failures generic", () => {
    expect(getPasswordAuthErrorMessage("sign-in", new Error("Failed query: secret details"))).toBe(
      "Unable to sign in. Check your credentials and try again.",
    );
  });
});
