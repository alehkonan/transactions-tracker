import { isIP } from "node:net";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "~/database/get-db.server";
import {
  credentialsTable,
  passwordCredentialsTable,
  profilesTable,
  usersTable,
} from "~/database/tables";
import {
  clearSignInUsernameRateLimit,
  enforceRegistrationRateLimit,
  enforceSignInRateLimit,
} from "./auth-rate-limit.server";
import { authMiddleware } from "./auth.middleware";
import { runDatabaseTransaction, runReadDatabaseTransaction } from "./database-resilience.server";
import { loggerMiddleware } from "./logger.middleware";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  getPasswordHash,
  hashPassword,
  isPasswordAllowed,
  verifyPassword,
} from "./password-credential.server";
import { createSession, destroySession, revokeOtherSessions } from "./session.server";
import {
  RP_NAME,
  consumeChallenge,
  generateWebauthnUserId,
  getRelyingParty,
  storeChallenge,
} from "./webauthn.server";
import type { AuthenticatorTransportFuture } from "@simplewebauthn/server";

const usernameSchema = z.string().trim().min(1).max(64);
const passwordSchema = z.string().refine(isPasswordAllowed, {
  message: `Password must be ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters.`,
});
const passwordAuthenticationSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
});
const credentialIdSchema = z.object({ credentialId: z.string().min(1) });

const transportsSchema = z.array(
  z.enum(["ble", "cable", "hybrid", "internal", "nfc", "smart-card", "usb"]),
);

const clientExtensionResultsSchema = z.object({
  appid: z.boolean().optional(),
  credProps: z.object({ rk: z.boolean().optional() }).optional(),
  hmacCreateSecret: z.boolean().optional(),
});

/**
 * Some browsers send an explicit `null` where the spec says the field should simply be absent,
 * which the SimpleWebAuthn types model as optional-only. Fold both onto `undefined`.
 */
function optionalField<T extends z.ZodType>(schema: T) {
  return schema.nullish().transform((value) => value ?? undefined);
}

const credentialBaseSchema = z.object({
  id: z.string(),
  rawId: z.string(),
  type: z.literal("public-key"),
  authenticatorAttachment: optionalField(z.enum(["cross-platform", "platform"])),
  clientExtensionResults: clientExtensionResultsSchema,
});

const registrationResponseSchema = credentialBaseSchema.extend({
  response: z.object({
    clientDataJSON: z.string(),
    attestationObject: z.string(),
    authenticatorData: z.string().optional(),
    transports: transportsSchema.optional(),
    publicKeyAlgorithm: z.number().optional(),
    publicKey: z.string().optional(),
  }),
});

const authenticationResponseSchema = credentialBaseSchema.extend({
  response: z.object({
    clientDataJSON: z.string(),
    authenticatorData: z.string(),
    signature: z.string(),
    userHandle: optionalField(z.string()),
  }),
});

const clientDataSchema = z.object({ challenge: z.string() });

/**
 * Pulls the challenge back out of the ceremony response so it can be looked up (and spent) before
 * the signature is checked against it.
 */
function readChallenge(clientDataJSON: string): string | null {
  try {
    const parsed = clientDataSchema.safeParse(
      JSON.parse(Buffer.from(clientDataJSON, "base64url").toString("utf8")),
    );
    return parsed.success ? parsed.data.challenge : null;
  } catch {
    return null;
  }
}

function badRequest(message: string): Response {
  return new Response(message, { status: 400 });
}

/**
 * Step one of sign-up: reserves the username, mints a challenge, and returns the options for
 * `navigator.credentials.create()`. No user row exists yet — it is created in `signUp()`, once
 * the authenticator has actually proven it holds the new key.
 */
export const getSignUpOptions = createServerFn({ method: "POST" })
  .middleware([loggerMiddleware])
  .validator(z.object({ username: usernameSchema }))
  .handler(async ({ data }) => {
    const [existing] = await getDb()
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.username, data.username));
    if (existing) throw badRequest("That username is already taken.");

    const { rpID } = getRelyingParty();
    const webauthnUserId = generateWebauthnUserId();

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID,
      userName: data.username,
      userDisplayName: data.username,
      userID: new Uint8Array(Buffer.from(webauthnUserId, "base64url")),
      attestationType: "none",
      authenticatorSelection: {
        // A discoverable credential is what lets sign-in work without the user typing anything.
        residentKey: "required",
        userVerification: "preferred",
      },
    });

    await storeChallenge({
      challenge: options.challenge,
      type: "REGISTRATION",
      username: data.username,
      webauthnUserId,
    });

    return options;
  });

/**
 * Step two of sign-up: verifies the attestation, creates the user and their first passkey, and
 * signs them straight in.
 */
export const signUp = createServerFn({ method: "POST" })
  .middleware([loggerMiddleware])
  .validator(registrationResponseSchema)
  .handler(async ({ data }) => {
    const challenge = readChallenge(data.response.clientDataJSON);
    if (!challenge) throw badRequest("Malformed registration response.");

    const pending = await consumeChallenge(challenge, "REGISTRATION");
    const username = pending?.username;
    const webauthnUserId = pending?.webauthnUserId;
    if (!username || !webauthnUserId) {
      throw badRequest("This registration attempt expired. Please try again.");
    }

    const { rpID, origin } = getRelyingParty();
    const verification = await verifyRegistrationResponse({
      response: data,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      // Platform passkeys always verify the user; not insisting on it here keeps authenticators
      // that only prove presence (e.g. a PIN-less security key) from failing outright.
      requireUserVerification: false,
    });

    if (!verification.verified) throw badRequest("Could not verify that passkey.");

    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

    // The user and their first passkey are all-or-nothing: an account with no way to sign in
    // would permanently squat the username.
    const user = await getDb().transaction(async (tx) => {
      const [firstExistingUser] = await tx.select({ id: usersTable.id }).from(usersTable).limit(1);

      const [created] = await tx
        .insert(usersTable)
        .values({ username, webauthnUserId })
        .returning({ id: usersTable.id, username: usersTable.username });

      await tx.insert(credentialsTable).values({
        id: credential.id,
        userId: created.id,
        publicKey: Buffer.from(credential.publicKey).toString("base64url"),
        counter: credential.counter,
        transports: credential.transports,
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
      });

      // Profiles that predate authentication have no owner. The very first account to be created
      // adopts them, so the existing data is simply there on first sign-in instead of being
      // stranded. The `IS NULL` guard makes this a no-op for everyone who signs up afterwards.
      if (!firstExistingUser) {
        await tx
          .update(profilesTable)
          .set({ userId: created.id })
          .where(isNull(profilesTable.userId));
      }

      return created;
    });

    // Kept outside the transaction: the session row's foreign key needs the committed user.
    await createSession(user);

    return user;
  });

/**
 * Step one of sign-in. `allowCredentials` is deliberately omitted: the browser then offers every
 * discoverable passkey it holds for this site, so the user picks an account instead of naming one.
 */
export const getSignInOptions = createServerFn({ method: "POST" })
  .middleware([loggerMiddleware])
  .handler(async () => {
    const { rpID } = getRelyingParty();
    const options = await generateAuthenticationOptions({ rpID, userVerification: "preferred" });

    await storeChallenge({ challenge: options.challenge, type: "AUTHENTICATION" });

    return options;
  });

/** Step two of sign-in: verifies the assertion against the stored public key and opens a session. */
export const signIn = createServerFn({ method: "POST" })
  .middleware([loggerMiddleware])
  .validator(authenticationResponseSchema)
  .handler(async ({ data }) => {
    const challenge = readChallenge(data.response.clientDataJSON);
    if (!challenge) throw badRequest("Malformed sign-in response.");

    const consumed = await consumeChallenge(challenge, "AUTHENTICATION");
    if (!consumed) throw badRequest("This sign-in attempt expired. Please try again.");

    const [record] = await getDb()
      .select({
        credential: credentialsTable,
        user: {
          id: usersTable.id,
          username: usersTable.username,
          webauthnUserId: usersTable.webauthnUserId,
        },
      })
      .from(credentialsTable)
      .innerJoin(usersTable, eq(usersTable.id, credentialsTable.userId))
      .where(eq(credentialsTable.id, data.id));

    if (!record) throw badRequest("That passkey is not registered here.");

    // For a discoverable credential the authenticator also reports whose key it is; if it
    // disagrees with our own mapping, something is wrong and we should not sign anyone in.
    const { userHandle } = data.response;
    if (userHandle && userHandle !== record.user.webauthnUserId) {
      throw badRequest("That passkey does not match this account.");
    }

    const parsedTransports = transportsSchema.safeParse(record.credential.transports);
    const transports: AuthenticatorTransportFuture[] | undefined = parsedTransports.success
      ? parsedTransports.data
      : undefined;

    const { rpID, origin } = getRelyingParty();
    const verification = await verifyAuthenticationResponse({
      response: data,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
      credential: {
        id: record.credential.id,
        publicKey: new Uint8Array(Buffer.from(record.credential.publicKey, "base64url")),
        counter: record.credential.counter,
        transports,
      },
    });

    if (!verification.verified) throw badRequest("Could not verify that passkey.");

    // A counter that fails to advance is how a cloned authenticator gives itself away; the
    // library enforces that, we just persist the new value.
    await getDb()
      .update(credentialsTable)
      .set({ counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() })
      .where(eq(credentialsTable.id, record.credential.id));

    const user = { id: record.user.id, username: record.user.username };
    await createSession(user);

    return user;
  });

export const signOut = createServerFn({ method: "POST" })
  .middleware([loggerMiddleware])
  .handler(async () => {
    await destroySession();
  });

function trustedNetlifyAddress(): string | undefined {
  if (process.env.NETLIFY !== "true") return undefined;

  const value = getRequest().headers.get("x-nf-client-connection-ip")?.trim();
  return value && isIP(value) !== 0 ? value : undefined;
}

function invalidCredentials(): Response {
  return new Response("Invalid username or password.", { status: 400 });
}

async function adoptLegacyProfilesIfFirstUser(
  database: Parameters<Parameters<typeof runDatabaseTransaction>[1]>[0],
  userId: number,
  isFirstUser: boolean,
): Promise<void> {
  if (isFirstUser) {
    await database.update(profilesTable).set({ userId }).where(isNull(profilesTable.userId));
  }
}

/** Creates an account whose initial credential is a password. */
export const passwordSignUp = createServerFn({ method: "POST" })
  .middleware([loggerMiddleware])
  .validator(passwordAuthenticationSchema)
  .handler(async ({ data }) => {
    await enforceRegistrationRateLimit({ address: trustedNetlifyAddress() });

    const [existing] = await getDb()
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.username, data.username))
      .limit(1);
    if (existing) throw badRequest("That username is already taken.");

    const passwordHash = await hashPassword(data.password);
    const user = await runDatabaseTransaction("auth.password_sign_up", async (database) => {
      // The lock turns the second existence check and insert into one explicit registration decision.
      await database.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`auth:username:${data.username}`}, 0))`,
      );
      const [racedExisting] = await database
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.username, data.username))
        .limit(1);
      if (racedExisting) throw badRequest("That username is already taken.");

      const [firstExistingUser] = await database
        .select({ id: usersTable.id })
        .from(usersTable)
        .limit(1);
      const [created] = await database
        .insert(usersTable)
        .values({ username: data.username, webauthnUserId: generateWebauthnUserId() })
        .returning({ id: usersTable.id, username: usersTable.username });
      await database.insert(passwordCredentialsTable).values({ userId: created.id, passwordHash });
      await adoptLegacyProfilesIfFirstUser(database, created.id, !firstExistingUser);
      return created;
    });

    await createSession(user);
    return user;
  });

/** Signs in through the password flow without revealing whether the username exists. */
export const passwordSignIn = createServerFn({ method: "POST" })
  .middleware([loggerMiddleware])
  .validator(passwordAuthenticationSchema)
  .handler(async ({ data }) => {
    await enforceSignInRateLimit({
      username: data.username,
      address: trustedNetlifyAddress(),
    });

    const [record] = await runReadDatabaseTransaction("auth.password_sign_in", (database) =>
      database
        .select({
          user: { id: usersTable.id, username: usersTable.username },
          passwordHash: passwordCredentialsTable.passwordHash,
        })
        .from(usersTable)
        .leftJoin(passwordCredentialsTable, eq(passwordCredentialsTable.userId, usersTable.id))
        .where(eq(usersTable.username, data.username))
        .limit(1),
    );

    // Always run scrypt, including for an unknown username or a passkey-only account.
    if (!(await verifyPassword(data.password, record?.passwordHash))) throw invalidCredentials();

    await clearSignInUsernameRateLimit(data.username);
    await createSession(record.user);
    return record.user;
  });

/** Returns non-secret metadata for every credential attached to the current account. */
export const listCredentials = createServerFn()
  .middleware([loggerMiddleware, authMiddleware])
  .handler(async ({ context }) => {
    const [password, passkeys] = await Promise.all([
      getDb()
        .select({
          createdAt: passwordCredentialsTable.createdAt,
          updatedAt: passwordCredentialsTable.updatedAt,
        })
        .from(passwordCredentialsTable)
        .where(eq(passwordCredentialsTable.userId, context.user.id))
        .limit(1),
      getDb()
        .select({
          id: credentialsTable.id,
          deviceType: credentialsTable.deviceType,
          backedUp: credentialsTable.backedUp,
          transports: credentialsTable.transports,
          createdAt: credentialsTable.createdAt,
          lastUsedAt: credentialsTable.lastUsedAt,
        })
        .from(credentialsTable)
        .where(eq(credentialsTable.userId, context.user.id)),
    ]);

    return { password: password[0] ?? null, passkeys };
  });

/** Starts a registration ceremony for an additional passkey owned by the signed-in user. */
export const startAddPasskey = createServerFn({ method: "POST" })
  .middleware([loggerMiddleware, authMiddleware])
  .handler(async ({ context }) => {
    const existing = await getDb()
      .select({ id: credentialsTable.id, transports: credentialsTable.transports })
      .from(credentialsTable)
      .where(eq(credentialsTable.userId, context.user.id));
    const { rpID } = getRelyingParty();
    const webauthnUserId = (
      await getDb()
        .select({ webauthnUserId: usersTable.webauthnUserId })
        .from(usersTable)
        .where(eq(usersTable.id, context.user.id))
        .limit(1)
    )[0]?.webauthnUserId;
    if (!webauthnUserId) throw new Response("Unauthorized", { status: 401 });

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID,
      userName: context.user.username,
      userDisplayName: context.user.username,
      userID: new Uint8Array(Buffer.from(webauthnUserId, "base64url")),
      attestationType: "none",
      authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
      excludeCredentials: existing.map((credential) => ({
        id: credential.id,
        transports: transportsSchema.safeParse(credential.transports).success
          ? (credential.transports as AuthenticatorTransportFuture[])
          : undefined,
      })),
    });
    await storeChallenge({
      challenge: options.challenge,
      type: "REGISTRATION",
      username: context.user.username,
      webauthnUserId,
    });
    return options;
  });

/** Verifies and stores an additional passkey for the signed-in user. */
export const finishAddPasskey = createServerFn({ method: "POST" })
  .middleware([loggerMiddleware, authMiddleware])
  .validator(registrationResponseSchema)
  .handler(async ({ data, context }) => {
    const challenge = readChallenge(data.response.clientDataJSON);
    if (!challenge) throw badRequest("Malformed registration response.");
    const pending = await consumeChallenge(challenge, "REGISTRATION");
    if (!pending || pending.username !== context.user.username || !pending.webauthnUserId) {
      throw badRequest("This registration attempt expired. Please try again.");
    }

    const [user] = await getDb()
      .select({ webauthnUserId: usersTable.webauthnUserId })
      .from(usersTable)
      .where(eq(usersTable.id, context.user.id))
      .limit(1);
    if (!user || user.webauthnUserId !== pending.webauthnUserId) {
      throw badRequest("This registration attempt does not belong to this account.");
    }

    const { rpID, origin } = getRelyingParty();
    const verification = await verifyRegistrationResponse({
      response: data,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });
    if (!verification.verified) throw badRequest("Could not verify that passkey.");

    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    await runDatabaseTransaction("auth.add_passkey", async (database) => {
      await database
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.id, context.user.id))
        .for("update");
      await database.insert(credentialsTable).values({
        id: credential.id,
        userId: context.user.id,
        publicKey: Buffer.from(credential.publicKey).toString("base64url"),
        counter: credential.counter,
        transports: credential.transports,
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
      });
    });

    return { id: credential.id };
  });

export const addPassword = createServerFn({ method: "POST" })
  .middleware([loggerMiddleware, authMiddleware])
  .validator(z.object({ password: passwordSchema }))
  .handler(async ({ data, context }) => {
    const passwordHash = await hashPassword(data.password);
    await runDatabaseTransaction("auth.add_password", async (database) => {
      await database
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.id, context.user.id))
        .for("update");
      const [existing] = await database
        .select({ userId: passwordCredentialsTable.userId })
        .from(passwordCredentialsTable)
        .where(eq(passwordCredentialsTable.userId, context.user.id))
        .limit(1);
      if (existing) throw badRequest("This account already has a password.");
      await database
        .insert(passwordCredentialsTable)
        .values({ userId: context.user.id, passwordHash });
    });
  });

export const changePassword = createServerFn({ method: "POST" })
  .middleware([loggerMiddleware, authMiddleware])
  .validator(z.object({ currentPassword: passwordSchema, newPassword: passwordSchema }))
  .handler(async ({ data, context }) => {
    const currentHash = await getPasswordHash(context.user.id);
    if (!(await verifyPassword(data.currentPassword, currentHash))) throw invalidCredentials();
    const passwordHash = await hashPassword(data.newPassword);

    await runDatabaseTransaction("auth.change_password", async (database) => {
      await database
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.id, context.user.id))
        .for("update");
      const changed = await database
        .update(passwordCredentialsTable)
        .set({ passwordHash, updatedAt: new Date() })
        .where(
          and(
            eq(passwordCredentialsTable.userId, context.user.id),
            eq(passwordCredentialsTable.passwordHash, currentHash!),
          ),
        )
        .returning({ userId: passwordCredentialsTable.userId });
      if (changed.length === 0) throw invalidCredentials();
    });
    await revokeOtherSessions(context.user.id);
  });

export const removePassword = createServerFn({ method: "POST" })
  .middleware([loggerMiddleware, authMiddleware])
  .validator(z.object({ currentPassword: passwordSchema }))
  .handler(async ({ data, context }) => {
    const currentHash = await getPasswordHash(context.user.id);
    if (!(await verifyPassword(data.currentPassword, currentHash))) throw invalidCredentials();

    await runDatabaseTransaction("auth.remove_password", async (database) => {
      await database
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.id, context.user.id))
        .for("update");
      const passkey = await database
        .select({ id: credentialsTable.id })
        .from(credentialsTable)
        .where(eq(credentialsTable.userId, context.user.id))
        .limit(1);
      if (!passkey[0]) throw badRequest("Add a passkey before removing your password.");
      const deleted = await database
        .delete(passwordCredentialsTable)
        .where(
          and(
            eq(passwordCredentialsTable.userId, context.user.id),
            eq(passwordCredentialsTable.passwordHash, currentHash!),
          ),
        )
        .returning({ userId: passwordCredentialsTable.userId });
      if (deleted.length === 0) throw badRequest("This account does not have a password.");
    });
    await revokeOtherSessions(context.user.id);
  });

export const removePasskey = createServerFn({ method: "POST" })
  .middleware([loggerMiddleware, authMiddleware])
  .validator(credentialIdSchema)
  .handler(async ({ data, context }) => {
    await runDatabaseTransaction("auth.remove_passkey", async (database) => {
      await database
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.id, context.user.id))
        .for("update");
      const [password, otherPasskey] = await Promise.all([
        database
          .select({ userId: passwordCredentialsTable.userId })
          .from(passwordCredentialsTable)
          .where(eq(passwordCredentialsTable.userId, context.user.id))
          .limit(1),
        database
          .select({ id: credentialsTable.id })
          .from(credentialsTable)
          .where(
            and(
              eq(credentialsTable.userId, context.user.id),
              ne(credentialsTable.id, data.credentialId),
            ),
          )
          .limit(1),
      ]);
      if (!password[0] && !otherPasskey[0]) {
        throw badRequest("Add another credential before removing this passkey.");
      }
      const deleted = await database
        .delete(credentialsTable)
        .where(
          and(
            eq(credentialsTable.userId, context.user.id),
            eq(credentialsTable.id, data.credentialId),
          ),
        )
        .returning({ id: credentialsTable.id });
      if (deleted.length === 0) throw new Response("Passkey not found.", { status: 404 });
    });
    await revokeOtherSessions(context.user.id);
  });
