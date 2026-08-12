ALTER TABLE "accounts" ADD COLUMN "initial_balance" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
-- Backfill: existing balances already include every transaction, so the opening
-- amount is whatever is left once the transaction history is subtracted.
UPDATE "accounts" SET "initial_balance" = "balance" - coalesce((
  SELECT sum("transactions"."amount") FROM "transactions"
  WHERE "transactions"."account_id" = "accounts"."id"
), 0);
