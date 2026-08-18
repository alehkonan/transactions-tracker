import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Tamper-proof cookie payloads: `base64url(json).base64url(hmac)`.
 *
 * A signed cookie is state the server can trust without looking anything up — which is the whole
 * point here, since every avoided lookup is a query the database does not run. Signing proves the
 * value came from us; it does not hide it, so nothing secret may go in one.
 *
 * Only safe to import from a server function's `.handler(...)` or another `.server.ts` module.
 */

/**
 * Read lazily rather than at module scope: the secret is only needed once a request is being
 * served, and a missing one should fail loudly there rather than at import time.
 */
function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "AUTH_SECRET is not set — cookies cannot be signed. Generate one with " +
        "`openssl rand -base64 32` and add it to .env (and to the deployment's environment).",
    );
  }
  return secret;
}

function computeSignature(body: string): string {
  return createHmac("sha256", getSecret()).update(body).digest("base64url");
}

/** Serializes `payload` and appends its signature. */
export function signCookieValue(payload: unknown): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${computeSignature(body)}`;
}

/**
 * Returns the payload only if the signature checks out, and `null` for anything else — missing,
 * malformed, or forged. Callers treat `null` as "not present" so a tampered cookie is simply
 * ignored rather than being an error path of its own.
 */
export function verifyCookieValue<T>(raw: string | undefined): T | null {
  if (!raw) return null;

  const separator = raw.lastIndexOf(".");
  if (separator === -1) return null;

  const body = raw.slice(0, separator);
  const signature = Buffer.from(raw.slice(separator + 1), "base64url");
  const expected = Buffer.from(computeSignature(body), "base64url");

  // `timingSafeEqual` throws on a length mismatch, which is itself a rejection.
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) return null;

  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}
