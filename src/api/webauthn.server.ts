import { randomBytes } from "node:crypto";
import { getRequestUrl } from "@tanstack/react-start/server";
import { and, eq, lt } from "drizzle-orm";
import { getDb } from "~/database/get-db.server";
import { webauthnChallengesTable } from "~/database/tables";

const CHALLENGE_TTL_SECONDS = 5 * 60;

export const RP_NAME = "Cracker Tracker";

type ChallengeType = (typeof webauthnChallengesTable.$inferSelect)["type"];

/**
 * The relying party the browser will bind credentials to.
 *
 * Netlify deployments use the configured production identity. Local Vite dev and preview derive it
 * from the request even when `.env` also carries production values, so a localhost ceremony cannot
 * accidentally receive a credential scoped to the deployed domain. WebAuthn requires a secure
 * context, so in practice local development means `localhost` only.
 */
export function getRelyingParty(): { rpID: string; origin: string } {
  if (process.env.NETLIFY !== "true") {
    const url = getRequestUrl();
    return { rpID: url.hostname, origin: url.origin };
  }

  const rpID = process.env.AUTH_RP_ID;
  const origin = process.env.AUTH_ORIGIN;
  if (!rpID || !origin) {
    throw new Error("AUTH_RP_ID and AUTH_ORIGIN are required in deployed environments");
  }
  return { rpID, origin };
}

/** Generates the opaque `user.id` handed to the authenticator as the WebAuthn user handle. */
export function generateWebauthnUserId(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Persists a challenge for an in-flight ceremony. Registration ceremonies also park the requested
 * username here, since the user row is not created until the attestation verifies.
 */
export async function storeChallenge(options: {
  challenge: string;
  type: ChallengeType;
  username?: string;
  webauthnUserId?: string;
}): Promise<void> {
  await getDb()
    .delete(webauthnChallengesTable)
    .where(lt(webauthnChallengesTable.expiresAt, new Date()));

  await getDb()
    .insert(webauthnChallengesTable)
    .values({
      challenge: options.challenge,
      type: options.type,
      username: options.username,
      webauthnUserId: options.webauthnUserId,
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000),
    });
}

/**
 * Atomically claims a challenge: the `DELETE ... RETURNING` means a given challenge can be spent
 * exactly once, which is what stops a captured ceremony response from being replayed. Returns
 * `null` when the challenge is unknown, of the wrong type, already spent, or expired.
 */
export async function consumeChallenge(
  challenge: string,
  type: ChallengeType,
): Promise<{ username: string | null; webauthnUserId: string | null } | null> {
  const [row] = await getDb()
    .delete(webauthnChallengesTable)
    .where(
      and(eq(webauthnChallengesTable.challenge, challenge), eq(webauthnChallengesTable.type, type)),
    )
    .returning();

  if (!row || row.expiresAt.getTime() < Date.now()) return null;
  return { username: row.username, webauthnUserId: row.webauthnUserId };
}
