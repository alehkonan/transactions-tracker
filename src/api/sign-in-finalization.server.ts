import { createSession } from "./session.server";
import { REPLICA_OWNER_MISMATCH } from "./sync-protocol.server";
import type { SessionUser } from "./session.server";

/** Issues cookies only after proven credentials agree with the bound local replica, when supplied. */
export async function completeSignIn(
  user: SessionUser,
  expectedUserId?: number,
): Promise<SessionUser> {
  if (expectedUserId != null && user.id !== expectedUserId) {
    throw Response.json(
      {
        code: REPLICA_OWNER_MISMATCH,
        error: "These credentials belong to a different user than this local replica.",
      },
      { status: 409 },
    );
  }

  await createSession(user);
  return user;
}
