ALTER TABLE "mutation_receipts" ADD COLUMN "intent_fingerprint" text;--> statement-breakpoint
ALTER TABLE "mutation_receipts" ADD COLUMN "conflict_outcome" jsonb;