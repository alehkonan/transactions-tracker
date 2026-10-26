import { z } from "zod";
import {
  accountStatusEnum,
  accountTypeEnum,
  currencyCodeEnum,
  necessityLevelEnum,
  transactionTypeEnum,
} from "~/database/enums";
import { assertCompleteOperations } from "~/modules/sync/outbox-acceptance";
import { PUSH_BATCH_LIMIT, SYNC_PROTOCOL_VERSION } from "~/modules/sync/sync-types";
import { WRITABLE_TABLES } from "~/modules/sync/synced-tables";
import type {
  AccountPayload,
  CategoryPayload,
  ProfilePayload,
  TransactionPayload,
  SpherePayload,
  ReallocationPayload,
} from "~/modules/sync/sync-types";

/** A client-minted id used by both the RPC and the plain HTTP push route. */
const rowIdSchema = z.uuid();

const mutationBaseSchema = {
  mutationId: z.uuid(),
  operation: z
    .object({ id: z.uuid(), mutationIds: z.array(z.uuid()).min(1).max(PUSH_BATCH_LIMIT) })
    .optional(),
  rowId: rowIdSchema,
  /** Epoch milliseconds, compared for equality against the stored row's — see `Mutation`. */
  baseUpdatedAt: z.number().int().nullable(),
};

const profilePayloadSchema = z.object({
  name: z.string().trim().min(1),
}) satisfies z.ZodType<ProfilePayload>;

const accountPayloadSchema = z.object({
  name: z.string().trim().min(1),
  initialBalance: z.string().trim(),
  currencyCode: z.enum(currencyCodeEnum.enumValues),
  status: z.enum(accountStatusEnum.enumValues),
  type: z.enum(accountTypeEnum.enumValues),
  profileId: rowIdSchema,
}) satisfies z.ZodType<AccountPayload>;

const categoryPayloadSchema = z.object({
  name: z.string().trim().min(1),
  colorId: z.number().int().nullable(),
  colorHex: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .optional(),
  profileId: rowIdSchema,
}) satisfies z.ZodType<CategoryPayload>;

const transactionPayloadSchema = z.object({
  sphereId: rowIdSchema.optional(),
  transferId: rowIdSchema.nullable().optional(),
  type: z.enum(transactionTypeEnum.enumValues),
  necessityLevel: z.enum(necessityLevelEnum.enumValues),
  amount: z.string(),
  comment: z.string().nullable(),
  // The RPC transport revives Dates for the page, while JSON from a service worker carries ISO text.
  createdAt: z.coerce.date(),
  accountId: rowIdSchema.nullable(),
  categoryId: rowIdSchema.nullable(),
  profileId: rowIdSchema,
}) satisfies z.ZodType<TransactionPayload>;

const spherePayloadSchema = z.object({
  profileId: rowIdSchema,
  name: z.string().trim().min(1),
  type: z.enum(["FUNDS", "CAPITAL"]),
  archived: z.boolean(),
}) satisfies z.ZodType<SpherePayload>;

const reallocationPayloadSchema = z.object({
  profileId: rowIdSchema,
  sphereId: rowIdSchema,
  reallocationId: rowIdSchema,
  transactionId: z.null(),
  openingAccountId: z.null(),
  amount: z.string().regex(/^-?(?:\d{1,12}(?:\.\d{1,2})?|\.\d{1,2})$/),
  currencyCode: z.enum(currencyCodeEnum.enumValues),
  createdAt: z.coerce.date(),
}) satisfies z.ZodType<ReallocationPayload>;

/**
 * A whole-row mutation. Keeping this in one module prevents the page RPC and the service-worker
 * endpoint from accepting different write protocols.
 */
const mutationSchema = z.union([
  z.object({ ...mutationBaseSchema, op: z.literal("delete"), table: z.enum(WRITABLE_TABLES) }),
  z.discriminatedUnion("table", [
    z.object({
      ...mutationBaseSchema,
      op: z.literal("upsert"),
      table: z.literal("profiles"),
      payload: profilePayloadSchema,
    }),
    z.object({
      ...mutationBaseSchema,
      op: z.literal("upsert"),
      table: z.literal("accounts"),
      payload: accountPayloadSchema,
    }),
    z.object({
      ...mutationBaseSchema,
      op: z.literal("upsert"),
      table: z.literal("categories"),
      payload: categoryPayloadSchema,
    }),
    z.object({
      ...mutationBaseSchema,
      op: z.literal("upsert"),
      table: z.literal("transactions"),
      payload: transactionPayloadSchema,
    }),
    z.object({
      ...mutationBaseSchema,
      op: z.literal("upsert"),
      table: z.literal("spheres"),
      payload: spherePayloadSchema,
    }),
    z.object({
      ...mutationBaseSchema,
      op: z.literal("upsert"),
      table: z.literal("allocations"),
      payload: reallocationPayloadSchema,
    }),
  ]),
]);

const replicaSyncContextSchema = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_VERSION),
  expectedOwnerUserId: z.number().int().positive(),
});

const cursorTimestampSchema = z
  .string()
  .max(64)
  .regex(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}(:?\d{2})?)?$/);

const cursorSchema = z.object({
  updatedAt: cursorTimestampSchema,
  id: z.uuid().nullable(),
});

export const pullChangesSchema = replicaSyncContextSchema.extend({
  cursors: z
    .object({
      profiles: cursorSchema.optional(),
      accounts: cursorSchema.optional(),
      categories: cursorSchema.optional(),
      transactions: cursorSchema.optional(),
      spheres: cursorSchema.optional(),
      allocations: cursorSchema.optional(),
    })
    .optional(),
  withCounts: z.boolean().optional(),
});

export const checkIntegritySchema = replicaSyncContextSchema;

export const pushChangesSchema = replicaSyncContextSchema.extend({
  mutations: z
    .array(mutationSchema)
    .max(PUSH_BATCH_LIMIT)
    .refine(
      (mutations) =>
        new Set(mutations.map((mutation) => mutation.mutationId)).size === mutations.length,
      { message: "Mutation ids must be unique within a push batch." },
    )
    .refine(
      (mutations) =>
        mutations.every(
          (mutation) =>
            mutation.table !== "allocations" ||
            (mutation.operation?.mutationIds.length === 2 &&
              mutation.operation.mutationIds.every((id) =>
                mutations.some(
                  (member) =>
                    member.mutationId === id &&
                    member.table === "allocations" &&
                    member.op === mutation.op,
                ),
              )),
        ),
      { message: "Reallocations require both allocation sides in one operation." },
    )
    .refine(
      (mutations) => {
        try {
          assertCompleteOperations(mutations);
          return true;
        } catch {
          return false;
        }
      },
      { message: "Financial operations must be complete and ordered." },
    ),
});
