import { createHash, randomBytes } from "node:crypto";
import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";
import { and, eq, gt, lt, or } from "drizzle-orm";
import { getDb } from "~/database/getDb.server";
import { sessionsTable, usersTable } from "~/database/tables";
import type { SQL } from "drizzle-orm";

export const ACCESS_TOKEN_COOKIE = "access_token";
export const REFRESH_TOKEN_COOKIE = "refresh_token";

const ACCESS_TOKEN_TTL_SECONDS = 60 * 60; // 1 hour
const REFRESH_TOKEN_TTL_SECONDS = 24 * 60 * 60; // 24 hours

/** The authenticated user, as exposed to server functions through middleware context. */
export type SessionUser = {
  id: number;
  username: string;
};

/**
 * 256 bits of CSPRNG output. The token itself is only ever held by the browser; the database
 * stores its hash, so the raw value exists in exactly one place.
 */
function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Plain SHA-256 — unlike a password, a 256-bit random token has no guessable structure, so there
 * is nothing for a slow KDF to protect against here.
 */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function expiresIn(seconds: number): Date {
  return new Date(Date.now() + seconds * 1000);
}

/**
 * `sameSite: "lax"` keeps the cookies off cross-site requests while still sending them on
 * top-level navigations into the app, which is what an SSR'd page needs to render logged in.
 */
function setTokenCookie(name: string, token: string, maxAge: number): void {
  setCookie(name, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  });
}

function clearSessionCookies(): void {
  deleteCookie(ACCESS_TOKEN_COOKIE, { path: "/" });
  deleteCookie(REFRESH_TOKEN_COOKIE, { path: "/" });
}

/** Issues a fresh session for `userId` and writes both tokens to the response cookies. */
export async function createSession(userId: number): Promise<void> {
  const accessToken = generateToken();
  const refreshToken = generateToken();

  await getDb()
    .insert(sessionsTable)
    .values({
      userId,
      accessTokenHash: hashToken(accessToken),
      accessTokenExpiresAt: expiresIn(ACCESS_TOKEN_TTL_SECONDS),
      refreshTokenHash: hashToken(refreshToken),
      refreshTokenExpiresAt: expiresIn(REFRESH_TOKEN_TTL_SECONDS),
    });

  setTokenCookie(ACCESS_TOKEN_COOKIE, accessToken, ACCESS_TOKEN_TTL_SECONDS);
  setTokenCookie(REFRESH_TOKEN_COOKIE, refreshToken, REFRESH_TOKEN_TTL_SECONDS);
}

/** Deletes the current session (if any) and clears both cookies. */
export async function destroySession(): Promise<void> {
  const refreshToken = getCookie(REFRESH_TOKEN_COOKIE);
  const accessToken = getCookie(ACCESS_TOKEN_COOKIE);

  const matchers: SQL[] = [];
  if (refreshToken) matchers.push(eq(sessionsTable.refreshTokenHash, hashToken(refreshToken)));
  if (accessToken) matchers.push(eq(sessionsTable.accessTokenHash, hashToken(accessToken)));
  if (matchers.length > 0)
    await getDb()
      .delete(sessionsTable)
      .where(or(...matchers));

  clearSessionCookies();
}

/** Best-effort cleanup so fully-expired sessions do not accumulate forever. */
async function deleteExpiredSessions(): Promise<void> {
  await getDb().delete(sessionsTable).where(lt(sessionsTable.refreshTokenExpiresAt, new Date()));
}

/**
 * Resolves the caller's session from their cookies, returning `null` when they are not logged in.
 *
 * A live access token is the fast path. Once it expires (after an hour) the still-valid refresh
 * token silently mints a new one — the refresh token's own 24h expiry is left untouched, so a
 * session ends a hard 24 hours after sign-in rather than sliding forward indefinitely.
 *
 * Only safe to call from a server function's `.handler(...)` or another `.server.ts` module.
 */
export async function resolveSession(): Promise<SessionUser | null> {
  const accessToken = getCookie(ACCESS_TOKEN_COOKIE);
  if (accessToken) {
    const [row] = await getDb()
      .select({ id: usersTable.id, username: usersTable.username })
      .from(sessionsTable)
      .innerJoin(usersTable, eq(usersTable.id, sessionsTable.userId))
      .where(
        and(
          eq(sessionsTable.accessTokenHash, hashToken(accessToken)),
          gt(sessionsTable.accessTokenExpiresAt, new Date()),
        ),
      );
    if (row) return row;
  }

  const refreshToken = getCookie(REFRESH_TOKEN_COOKIE);
  if (!refreshToken) {
    // An access token that resolved to nothing is stale or forged either way — stop resending it.
    if (accessToken) clearSessionCookies();
    return null;
  }

  const [session] = await getDb()
    .select({
      id: sessionsTable.id,
      user: { id: usersTable.id, username: usersTable.username },
    })
    .from(sessionsTable)
    .innerJoin(usersTable, eq(usersTable.id, sessionsTable.userId))
    .where(
      and(
        eq(sessionsTable.refreshTokenHash, hashToken(refreshToken)),
        gt(sessionsTable.refreshTokenExpiresAt, new Date()),
      ),
    );

  if (!session) {
    clearSessionCookies();
    void deleteExpiredSessions().catch(() => {});
    return null;
  }

  const rotatedAccessToken = generateToken();
  await getDb()
    .update(sessionsTable)
    .set({
      accessTokenHash: hashToken(rotatedAccessToken),
      accessTokenExpiresAt: expiresIn(ACCESS_TOKEN_TTL_SECONDS),
    })
    .where(eq(sessionsTable.id, session.id));
  setTokenCookie(ACCESS_TOKEN_COOKIE, rotatedAccessToken, ACCESS_TOKEN_TTL_SECONDS);

  return session.user;
}
