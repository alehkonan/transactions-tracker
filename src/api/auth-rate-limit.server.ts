import { createHmac, randomInt } from "node:crypto";
import { and, asc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { authAttemptsTable } from "~/database/tables";
import { runDatabaseTransaction } from "./database-resilience.server";

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const CLEANUP_BATCH_SIZE = 100;
const CLEANUP_SAMPLE_RATE = 64;
const RETENTION = HOUR;

export const AUTH_RATE_LIMITS = {
  signInUsername: { kind: "sign-in-username", limit: 5, windowMs: 15 * MINUTE },
  signInAddress: { kind: "sign-in-address", limit: 30, windowMs: 15 * MINUTE },
  registrationAddress: { kind: "registration-address", limit: 10, windowMs: HOUR },
} as const;

type RateLimitRule = (typeof AUTH_RATE_LIMITS)[keyof typeof AUTH_RATE_LIMITS];
type ConsumeAttempt = (input: {
  kind: RateLimitRule["kind"];
  keyDigest: string;
  limit: number;
  windowMs: number;
  now: Date;
}) => Promise<{ retryAfterSeconds: number } | null>;

function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is required for authentication rate limiting.");
  return secret;
}

/** Hides usernames and network addresses behind a deployment-secret keyed digest. */
export function digestAuthRateLimitKey(identifier: string, secret = getAuthSecret()): string {
  return createHmac("sha256", secret).update(identifier, "utf8").digest("base64url");
}

/** A deliberately generic response that reveals neither the limited identifier nor its bucket. */
export function authRateLimitResponse(retryAfterSeconds: number): Response {
  return Response.json(
    { error: "Too many authentication attempts. Please try again later." },
    {
      status: 429,
      headers: { "Retry-After": String(Math.max(1, Math.ceil(retryAfterSeconds))) },
    },
  );
}

async function cleanupExpiredAttempts(
  database: Parameters<Parameters<typeof runDatabaseTransaction>[1]>[0],
  now: Date,
) {
  if (randomInt(CLEANUP_SAMPLE_RATE) !== 0) return;

  const expired = await database
    .select({ id: authAttemptsTable.id })
    .from(authAttemptsTable)
    .where(lt(authAttemptsTable.attemptedAt, new Date(now.getTime() - RETENTION)))
    .orderBy(asc(authAttemptsTable.attemptedAt))
    .limit(CLEANUP_BATCH_SIZE);

  if (expired.length > 0) {
    await database.delete(authAttemptsTable).where(
      inArray(
        authAttemptsTable.id,
        expired.map(({ id }) => id),
      ),
    );
  }
}

const consumeDatabaseAttempt: ConsumeAttempt = (input) =>
  runDatabaseTransaction("auth.rate_limit", async (database) => {
    // Serialize a single HMAC bucket so concurrent serverless requests cannot all observe spare quota.
    await database.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${input.kind}:${input.keyDigest}`}, 0))`,
    );
    await cleanupExpiredAttempts(database, input.now);

    const cutoff = new Date(input.now.getTime() - input.windowMs);
    const recent = await database
      .select({ attemptedAt: authAttemptsTable.attemptedAt })
      .from(authAttemptsTable)
      .where(
        and(
          eq(authAttemptsTable.kind, input.kind),
          eq(authAttemptsTable.keyDigest, input.keyDigest),
          gt(authAttemptsTable.attemptedAt, cutoff),
        ),
      )
      .orderBy(asc(authAttemptsTable.attemptedAt))
      .limit(input.limit);

    if (recent.length >= input.limit) {
      return {
        retryAfterSeconds: Math.max(
          1,
          Math.ceil(
            (recent[0].attemptedAt.getTime() + input.windowMs - input.now.getTime()) / SECOND,
          ),
        ),
      };
    }

    await database.insert(authAttemptsTable).values({
      kind: input.kind,
      keyDigest: input.keyDigest,
      attemptedAt: input.now,
    });
    return null;
  });

export function createAuthRateLimiter(dependencies: {
  consumeAttempt: ConsumeAttempt;
  digestKey?: (identifier: string) => string;
  now?: () => Date;
}) {
  const digestKey = dependencies.digestKey ?? digestAuthRateLimitKey;
  const now = dependencies.now ?? (() => new Date());

  async function enforce(identifier: string, rule: RateLimitRule): Promise<void> {
    const limited = await dependencies.consumeAttempt({
      ...rule,
      keyDigest: digestKey(identifier),
      now: now(),
    });
    if (limited) throw authRateLimitResponse(limited.retryAfterSeconds);
  }

  return {
    async enforceSignIn(input: { username: string; address?: string }): Promise<void> {
      // Check the broader address bucket first so abusive traffic does not consume a victim's username quota.
      if (input.address !== undefined) await enforce(input.address, AUTH_RATE_LIMITS.signInAddress);
      await enforce(input.username, AUTH_RATE_LIMITS.signInUsername);
    },

    async enforceRegistration(input: { address?: string }): Promise<void> {
      if (input.address !== undefined) {
        await enforce(input.address, AUTH_RATE_LIMITS.registrationAddress);
      }
    },
  };
}

const authRateLimiter = createAuthRateLimiter({ consumeAttempt: consumeDatabaseAttempt });

/** `address` must come from trusted infrastructure; this module intentionally does not inspect headers. */
export const enforceSignInRateLimit = authRateLimiter.enforceSignIn;

/** Clears only the username bucket after successful authentication; address pressure remains intact. */
export async function clearSignInUsernameRateLimit(username: string): Promise<void> {
  await runDatabaseTransaction("auth.rate_limit_clear_username", (database) =>
    database
      .delete(authAttemptsTable)
      .where(
        and(
          eq(authAttemptsTable.kind, AUTH_RATE_LIMITS.signInUsername.kind),
          eq(authAttemptsTable.keyDigest, digestAuthRateLimitKey(username)),
        ),
      ),
  );
}

/** `address` must come from trusted infrastructure; omit it when no trusted value is available. */
export const enforceRegistrationRateLimit = authRateLimiter.enforceRegistration;
