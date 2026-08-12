ALTER TABLE "sessions" DROP CONSTRAINT "sessions_access_token_hash_unique";--> statement-breakpoint
CREATE INDEX "accounts_profile_id_idx" ON "accounts" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "categories_profile_id_idx" ON "categories" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "transactions_account_id_created_at_idx" ON "transactions" USING btree ("account_id","created_at");--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN "access_token_hash";--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN "access_token_expires_at";