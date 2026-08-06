CREATE TYPE "public"."transaction_type" AS ENUM('INCOME', 'EXPENSE', 'TRANSFER');--> statement-breakpoint
CREATE TABLE "colors" (
	"id" serial PRIMARY KEY NOT NULL,
	"hex" varchar(7) NOT NULL,
	CONSTRAINT "colors_hex_unique" UNIQUE("hex")
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_income_account_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_outcome_account_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_category_id_categories_id_fk";
--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "necessity_level" SET DEFAULT 'MEDIUM';--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "necessity_level" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "profile_id" integer;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "profile_id" integer;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "color_id" integer;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "type" "transaction_type" NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "amount" numeric(14, 2) NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "account_id" integer;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_color_id_colors_id_fk" FOREIGN KEY ("color_id") REFERENCES "public"."colors"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "categories" DROP COLUMN "default_necessity_level";--> statement-breakpoint
ALTER TABLE "transactions" DROP COLUMN "income_account_id";--> statement-breakpoint
ALTER TABLE "transactions" DROP COLUMN "income_amount";--> statement-breakpoint
ALTER TABLE "transactions" DROP COLUMN "income_currency";--> statement-breakpoint
ALTER TABLE "transactions" DROP COLUMN "outcome_account_id";--> statement-breakpoint
ALTER TABLE "transactions" DROP COLUMN "outcome_amount";--> statement-breakpoint
ALTER TABLE "transactions" DROP COLUMN "outcome_currency";