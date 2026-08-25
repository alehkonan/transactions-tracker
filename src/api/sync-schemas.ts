import { z } from "zod";
import {
  accountStatusEnum,
  accountTypeEnum,
  currencyCodeEnum,
  necessityLevelEnum,
  transactionTypeEnum,
} from "~/database/enums";
import { PUSH_BATCH_LIMIT, SYNCED_TABLES } from "~/modules/sync/sync-types";
import type {
  AccountPayload,
  CategoryPayload,
  ProfilePayload,
  TransactionPayload,
} from "~/modules/sync/sync-types";

/** A client-minted id used by both the RPC and the plain HTTP push route. */
const rowIdSchema = z.uuid();

const mutationBaseSchema = {
  mutationId: z.uuid(),
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

/**
 * A whole-row mutation. Keeping this in one module prevents the page RPC and the service-worker
 * endpoint from accepting different write protocols.
 */
const mutationSchema = z.union([
  z.object({ ...mutationBaseSchema, op: z.literal("delete"), table: z.enum(SYNCED_TABLES) }),
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
  ]),
]);

export const pushChangesSchema = z.object({
  mutations: z.array(mutationSchema).max(PUSH_BATCH_LIMIT),
});
