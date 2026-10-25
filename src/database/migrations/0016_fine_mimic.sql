LOCK TABLE profiles, accounts, transactions, spheres, allocations IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
ALTER TABLE "allocations" DROP CONSTRAINT "allocations_source_check";--> statement-breakpoint
ALTER TABLE "allocations" ADD COLUMN "reallocation_id" uuid;--> statement-breakpoint
CREATE INDEX "allocations_reallocation_id_idx" ON "allocations" USING btree ("reallocation_id");--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_source_check" CHECK (num_nonnulls("allocations"."transaction_id", "allocations"."opening_account_id", "allocations"."reallocation_id") = 1);
