import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { createServerFn } from "@tanstack/react-start";
import { eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "~/database/get-db.server";
import { credentialsTable, profilesTable, usersTable } from "~/database/tables";
import { loggerMiddleware } from "./logger.middleware";
import { createSession, destroySession } from "./session.server";
import {
  RP_NAME,
  consumeChallenge,
  generateWebauthnUserId,
  getRelyingParty,
  storeChallenge,
} from "./webauthn.server";
import type { AuthenticatorTransportFuture } from "@simplewebauthn/server";

const usernameSchema = z.string().trim().min(1).max(64);

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
