-- Re-keys the four synced tables (profiles, accounts, categories, transactions) from `serial` to
-- `uuid`, and gives them the columns a delta sync needs: `updated_at`, a `deleted_at` tombstone,
-- and a denormalized `transactions.profile_id`. See `docs/offline-first-sync.md`.
--
-- Hand-written: drizzle-kit's diff is a bare `ALTER COLUMN ... SET DATA TYPE uuid`, which has no
-- cast from integer and would in any case leave every foreign key pointing at the old values. The
-- swap below adds parallel columns, backfills them through the existing keys, and only then drops
-- the originals — so the row graph survives.

-- Indexes whose leading column is about to be dropped go with it; `profiles_user_id_idx` is on a
-- column that stays, and is superseded by the composite created at the end.
DROP INDEX IF EXISTS "profiles_user_id_idx";--> statement-breakpoint

-- 1. New identities, minted for every existing row. `gen_random_uuid()` (v4) is fine here: only
-- rows the client creates are v7, and ordering never comes from the id alone.
ALTER TABLE "profiles" ADD COLUMN "id_uuid" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "id_uuid" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "id_uuid" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "id_uuid" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint

-- 2. Parallel foreign keys, translated through the integer ones they replace.
ALTER TABLE "accounts" ADD COLUMN "profile_id_uuid" uuid;--> statement-breakpoint
UPDATE "accounts" SET "profile_id_uuid" = "profiles"."id_uuid"
  FROM "profiles" WHERE "profiles"."id" = "accounts"."profile_id";--> statement-breakpoint

ALTER TABLE "categories" ADD COLUMN "profile_id_uuid" uuid;--> statement-breakpoint
UPDATE "categories" SET "profile_id_uuid" = "profiles"."id_uuid"
  FROM "profiles" WHERE "profiles"."id" = "categories"."profile_id";--> statement-breakpoint

ALTER TABLE "transactions" ADD COLUMN "account_id_uuid" uuid;--> statement-breakpoint
UPDATE "transactions" SET "account_id_uuid" = "accounts"."id_uuid"
  FROM "accounts" WHERE "accounts"."id" = "transactions"."account_id";--> statement-breakpoint

ALTER TABLE "transactions" ADD COLUMN "category_id_uuid" uuid;--> statement-breakpoint
UPDATE "transactions" SET "category_id_uuid" = "categories"."id_uuid"
  FROM "categories" WHERE "categories"."id" = "transactions"."category_id";--> statement-breakpoint

-- 3. The denormalized profile, taken from the account the transaction is filed against.
ALTER TABLE "transactions" ADD COLUMN "profile_id" uuid;--> statement-breakpoint
UPDATE "transactions" SET "profile_id" = "accounts"."profile_id_uuid"
  FROM "accounts" WHERE "accounts"."id" = "transactions"."account_id";--> statement-breakpoint

-- A transaction with no account, or whose account was never assigned a profile, has no profile to
-- inherit. Such a row is already unreachable through the app (every read is profile-scoped), but
-- it is still somebody's data, so stop here rather than guess or delete.
DO $$
DECLARE orphan_count bigint;
BEGIN
  SELECT count(*) INTO orphan_count FROM "transactions" WHERE "profile_id" IS NULL;
  IF orphan_count > 0 THEN
    RAISE EXCEPTION
      'Cannot backfill transactions.profile_id for % row(s): they have no account, or their account has no profile. Assign those accounts a profile (or remove the rows) and re-run.',
      orphan_count;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "profile_id" SET NOT NULL;--> statement-breakpoint

-- 4. Unhook the integer keys, then swap the columns in. Dropping a column takes its primary key,
-- its sequence and any index over it with it.
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_profile_id_profiles_id_fk";--> statement-breakpoint
ALTER TABLE "categories" DROP CONSTRAINT "categories_profile_id_profiles_id_fk";--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_account_id_accounts_id_fk";--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_category_id_categories_id_fk";--> statement-breakpoint

ALTER TABLE "transactions" DROP COLUMN "id";--> statement-breakpoint
ALTER TABLE "transactions" DROP COLUMN "account_id";--> statement-breakpoint
ALTER TABLE "transactions" DROP COLUMN "category_id";--> statement-breakpoint
ALTER TABLE "transactions" RENAME COLUMN "id_uuid" TO "id";--> statement-breakpoint
ALTER TABLE "transactions" RENAME COLUMN "account_id_uuid" TO "account_id";--> statement-breakpoint
ALTER TABLE "transactions" RENAME COLUMN "category_id_uuid" TO "category_id";--> statement-breakpoint

ALTER TABLE "accounts" DROP COLUMN "id";--> statement-breakpoint
ALTER TABLE "accounts" DROP COLUMN "profile_id";--> statement-breakpoint
ALTER TABLE "accounts" RENAME COLUMN "id_uuid" TO "id";--> statement-breakpoint
ALTER TABLE "accounts" RENAME COLUMN "profile_id_uuid" TO "profile_id";--> statement-breakpoint

ALTER TABLE "categories" DROP COLUMN "id";--> statement-breakpoint
ALTER TABLE "categories" DROP COLUMN "profile_id";--> statement-breakpoint
ALTER TABLE "categories" RENAME COLUMN "id_uuid" TO "id";--> statement-breakpoint
ALTER TABLE "categories" RENAME COLUMN "profile_id_uuid" TO "profile_id";--> statement-breakpoint

ALTER TABLE "profiles" DROP COLUMN "id";--> statement-breakpoint
ALTER TABLE "profiles" RENAME COLUMN "id_uuid" TO "id";--> statement-breakpoint

-- 5. Re-establish the row graph on the new keys.
ALTER TABLE "profiles" ADD PRIMARY KEY ("id");--> statement-breakpoint
ALTER TABLE "accounts" ADD PRIMARY KEY ("id");--> statement-breakpoint
ALTER TABLE "categories" ADD PRIMARY KEY ("id");--> statement-breakpoint
ALTER TABLE "transactions" ADD PRIMARY KEY ("id");--> statement-breakpoint

ALTER TABLE "accounts" ADD CONSTRAINT "accounts_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint

-- 6. Sync bookkeeping. Every row lands with the same `updated_at`, which is why a pull cursor has
-- to be the composite `(updated_at, id)` rather than the timestamp on its own.
ALTER TABLE "profiles" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint

CREATE INDEX "profiles_user_id_updated_at_id_idx" ON "profiles" USING btree ("user_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "accounts_profile_id_updated_at_id_idx" ON "accounts" USING btree ("profile_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "categories_profile_id_updated_at_id_idx" ON "categories" USING btree ("profile_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "transactions_profile_id_updated_at_id_idx" ON "transactions" USING btree ("profile_id","updated_at","id");--> statement-breakpoint
-- Recreated rather than kept: it indexed the integer `account_id` and was dropped along with it.
CREATE INDEX "transactions_account_id_created_at_idx" ON "transactions" USING btree ("account_id","created_at");
