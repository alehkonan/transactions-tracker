import { createHash, randomBytes } from "node:crypto";
import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";
import { and, eq, gt, lt, or } from "drizzle-orm";
import { getDb } from "~/database/get-db.server";
import { sessionsTable, usersTable } from "~/database/tables";
import { SESSION_HINT_COOKIE } from "~/modules/auth/session-hint";
import { clearSelectedProfileCookies } from "./selected-profile.server";
import { signCookieValue, verifyCookieValue } from "./signed-cookie.server";
import type { SQL } from "drizzle-orm";

const ACCESS_TOKEN_COOKIE = "access_token";
const REFRESH_TOKEN_COOKIE = "refresh_token";

const ACCESS_TOKEN_TTL_SECONDS = 60 * 60; // 1 hour
const REFRESH_TOKEN_TTL_SECONDS = 24 * 60 * 60; // 24 hours

/** The authenticated user, as exposed to server functions through middleware context. */
export type SessionUser = {
  id: number;
  username: string;
};

/**
 * What the signed access cookie carries. Everything needed to answer "who is calling" is in here,
 * which is the point: resolving a session costs no query at all until the hour is up.
 *
 * `expiresAt` is inside the signature, so it is the browser's copy of the deadline but not the
 * browser's to move — unlike the cookie's own `maxAge`, which is only a hint to the client.
 */
type AccessTokenPayload = {
  sessionId: number;
  userId: number;
  username: string;
  /** Epoch milliseconds. */
  expiresAt: number;
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

/**
 * Mirrors the session's deadline into a cookie the client can actually read, so route guards can
 * decide locally instead of asking the server. Deliberately not `httpOnly` — and deliberately
 * holding nothing but a timestamp.
 */
function setSessionHintCookie(expiresAt: Date): void {
  setCookie(SESSION_HINT_COOKIE, String(expiresAt.getTime()), {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: REFRESH_TOKEN_TTL_SECONDS,
  });
}

/** Signs a fresh access cookie for an already-established session row. */
function issueAccessToken(session: Omit<AccessTokenPayload, "expiresAt">): void {
  const payload: AccessTokenPayload = {
    ...session,
    expiresAt: Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000,
  };
  setTokenCookie(ACCESS_TOKEN_COOKIE, signCookieValue(payload), ACCESS_TOKEN_TTL_SECONDS);
}

/**
 * Clears everything the session put on the browser, including the selected profile: that cookie is
 * scoped to a user, so leaving it behind would only ever be a stale claim.
 */
function clearSessionCookies(): void {
  for (const name of [ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE, SESSION_HINT_COOKIE]) {
    deleteCookie(name, { path: "/" });
  }
  clearSelectedProfileCookies();
}

/** Issues a fresh session for `user` and writes the cookies to the response. */
export async function createSession(user: SessionUser): Promise<void> {
  const refreshToken = generateToken();
  const refreshTokenExpiresAt = expiresIn(REFRESH_TOKEN_TTL_SECONDS);

  const [session] = await getDb()
    .insert(sessionsTable)
    .values({
      userId: user.id,
      refreshTokenHash: hashToken(refreshToken),
      refreshTokenExpiresAt,
    })
    .returning({ id: sessionsTable.id });

  issueAccessToken({ sessionId: session.id, userId: user.id, username: user.username });
  setTokenCookie(REFRESH_TOKEN_COOKIE, refreshToken, REFRESH_TOKEN_TTL_SECONDS);
  setSessionHintCookie(refreshTokenExpiresAt);
}

/** Deletes the current session (if any) and clears the cookies. */
export async function destroySession(): Promise<void> {
  const access = verifyCookieValue<AccessTokenPayload>(getCookie(ACCESS_TOKEN_COOKIE));
  const refreshToken = getCookie(REFRESH_TOKEN_COOKIE);

  // Either cookie identifies the row on its own; an expired access token still names a session
  // that should go, so the deadline is not checked here.
  const matchers: SQL[] = [];
  if (access) matchers.push(eq(sessionsTable.id, access.sessionId));
  if (refreshToken) matchers.push(eq(sessionsTable.refreshTokenHash, hashToken(refreshToken)));
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
 * A valid access cookie is the fast path and costs **no database query** — its signature is what
 * makes the payload trustworthy. Once it expires (after an hour) the still-valid refresh token
 * mints a new one, and that is the only branch that touches the database. The refresh token's own
 * 24h expiry is left untouched, so a session ends a hard 24 hours after sign-in rather than
 * sliding forward indefinitely.
 *
 * The cost of not reading the session row every time is that revoking a session takes effect when
 * the access cookie next expires, rather than immediately.
 *
 * Only safe to call from a server function's `.handler(...)` or another `.server.ts` module.
 */
export async function resolveSession(): Promise<SessionUser | null> {
  const access = verifyCookieValue<AccessTokenPayload>(getCookie(ACCESS_TOKEN_COOKIE));
  if (access && access.expiresAt > Date.now()) {
    return { id: access.userId, username: access.username };
  }

  const refreshToken = getCookie(REFRESH_TOKEN_COOKIE);
  if (!refreshToken) {
    // An access cookie that resolved to nothing is stale or forged either way — stop resending it.
    if (access) clearSessionCookies();
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

  issueAccessToken({
    sessionId: session.id,
    userId: session.user.id,
    username: session.user.username,
  });

  return session.user;
}
