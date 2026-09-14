import { beforeEach, describe, expect, it, vi } from "vitest";

const { createSession } = vi.hoisted(() => ({ createSession: vi.fn() }));

vi.mock("./session.server", () => ({ createSession }));

import { completeSignIn } from "./sign-in-finalization.server";

describe("completeSignIn", () => {
  beforeEach(() => {
    createSession.mockReset();
    createSession.mockResolvedValue(undefined);
  });

  it("does not create another user's session during replica reauthentication", async () => {
    try {
      await completeSignIn({ id: 42, username: "user-b" }, 41);
      throw new Error("Expected reauthentication to reject a different user.");
    } catch (error) {
      expect(error).toBeInstanceOf(Response);
      const response = error as Response;
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({ code: "REPLICA_OWNER_MISMATCH" });
    }

    expect(createSession).not.toHaveBeenCalled();
  });

  it("creates a session and returns server-confirmed identity for the expected user", async () => {
    const user = { id: 41, username: "user-a" };

    await expect(completeSignIn(user, 41)).resolves.toEqual(user);
    expect(createSession).toHaveBeenCalledWith(user);
  });

  it("keeps ordinary sign-in available when no replica owner is supplied", async () => {
    const user = { id: 42, username: "user-b" };

    await expect(completeSignIn(user)).resolves.toEqual(user);
    expect(createSession).toHaveBeenCalledWith(user);
  });
});
