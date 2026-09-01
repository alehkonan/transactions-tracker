import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { passwordCredentialsTable } from "~/database/tables";
import { runDatabaseTransaction, runReadDatabaseTransaction } from "./database-resilience.server";

const FORMAT = "scrypt";
const VERSION = 1;
const COST = 16_384;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 32;
const MAX_MEMORY = 64 * 1024 * 1024;

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

// A syntactically valid hash with a fixed, non-secret salt/key. Verification still performs the same
// scrypt work when no credential exists, reducing username-enumeration timing differences.
const DUMMY_PASSWORD_HASH =
  "scrypt$v=1$N=16384,r=8,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

type ScryptParameters = {
  cost: number;
  blockSize: number;
  parallelization: number;
  salt: Buffer;
  key: Buffer;
};

/** Checks code-point length without trimming or otherwise changing the submitted password. */
export function isPasswordAllowed(password: string): boolean {
  const length = Array.from(password).length;
  return length >= MIN_PASSWORD_LENGTH && length <= MAX_PASSWORD_LENGTH;
}

export function assertPasswordAllowed(password: string): void {
  if (!isPasswordAllowed(password)) {
    throw new Error(`Password must be ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters.`);
  }
}

function deriveKey(password: string, parameters: Omit<ScryptParameters, "key">): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      parameters.salt,
      KEY_BYTES,
      {
        N: parameters.cost,
        r: parameters.blockSize,
        p: parameters.parallelization,
        maxmem: MAX_MEMORY,
      },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      },
    );
  });
}

function parsePasswordHash(encoded: string): ScryptParameters | null {
  const [format, versionPart, parametersPart, saltPart, keyPart, ...rest] = encoded.split("$");
  if (format !== FORMAT || versionPart !== `v=${VERSION}` || rest.length > 0) return null;

  const match = /^N=(\d+),r=(\d+),p=(\d+)$/.exec(parametersPart ?? "");
  if (!match) return null;

  const parameters = {
    cost: Number(match[1]),
    blockSize: Number(match[2]),
    parallelization: Number(match[3]),
  };
  if (
    parameters.cost !== COST ||
    parameters.blockSize !== BLOCK_SIZE ||
    parameters.parallelization !== PARALLELIZATION
  ) {
    return null;
  }

  try {
    const salt = Buffer.from(saltPart ?? "", "base64url");
    const key = Buffer.from(keyPart ?? "", "base64url");
    if (salt.length !== SALT_BYTES || key.length !== KEY_BYTES) return null;
    return { ...parameters, salt, key };
  } catch {
    return null;
  }
}

/** Produces a versioned, self-describing scrypt hash with a fresh random salt. */
export async function hashPassword(password: string): Promise<string> {
  assertPasswordAllowed(password);
  const salt = randomBytes(SALT_BYTES);
  const key = await deriveKey(password, {
    cost: COST,
    blockSize: BLOCK_SIZE,
    parallelization: PARALLELIZATION,
    salt,
  });

  return `${FORMAT}$v=${VERSION}$N=${COST},r=${BLOCK_SIZE},p=${PARALLELIZATION}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

/**
 * Verifies in constant time after scrypt. A missing or malformed stored hash uses the dummy hash so
 * callers can use the same path for unknown usernames without revealing account existence by timing.
 */
export async function verifyPassword(
  password: string,
  encodedHash?: string | null,
): Promise<boolean> {
  const parsed = parsePasswordHash(encodedHash ?? "") ?? parsePasswordHash(DUMMY_PASSWORD_HASH);
  if (!parsed) throw new Error("Internal dummy password hash is invalid.");

  const candidate = await deriveKey(password, parsed);
  const matches = timingSafeEqual(candidate, parsed.key);
  return encodedHash != null && parsePasswordHash(encodedHash) != null && matches;
}

export async function getPasswordHash(userId: number): Promise<string | null> {
  const [credential] = await runReadDatabaseTransaction(
    "auth.read_password_credential",
    (database) =>
      database
        .select({ passwordHash: passwordCredentialsTable.passwordHash })
        .from(passwordCredentialsTable)
        .where(eq(passwordCredentialsTable.userId, userId))
        .limit(1),
  );
  return credential?.passwordHash ?? null;
}

/** Creates or replaces a user's password credential. The caller supplies an already-policy-checked password. */
export async function setPasswordCredential(userId: number, password: string): Promise<void> {
  const passwordHash = await hashPassword(password);
  await runDatabaseTransaction("auth.set_password_credential", (database) =>
    database
      .insert(passwordCredentialsTable)
      .values({ userId, passwordHash })
      .onConflictDoUpdate({
        target: passwordCredentialsTable.userId,
        set: { passwordHash, updatedAt: new Date() },
      }),
  );
}

export async function deletePasswordCredential(userId: number): Promise<void> {
  await runDatabaseTransaction("auth.delete_password_credential", (database) =>
    database.delete(passwordCredentialsTable).where(eq(passwordCredentialsTable.userId, userId)),
  );
}
