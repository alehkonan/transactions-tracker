CREATE TABLE "mutation_receipts" (
	"user_id" integer NOT NULL,
	"mutation_id" uuid NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mutation_receipts_user_id_mutation_id_pk" PRIMARY KEY("user_id","mutation_id")
);
--> statement-breakpoint
ALTER TABLE "mutation_receipts" ADD CONSTRAINT "mutation_receipts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;