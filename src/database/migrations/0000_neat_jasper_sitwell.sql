CREATE TYPE "public"."account_status" AS ENUM('ACTIVE', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."account_type" AS ENUM('CURRENT', 'SAVING');--> statement-breakpoint
CREATE TYPE "public"."currency_code" AS ENUM('USD', 'GEL');--> statement-breakpoint
CREATE TYPE "public"."necessity_level" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'ESSENTIAL');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"balance" numeric(14, 2) DEFAULT '0' NOT NULL,
	"type" "account_type" DEFAULT 'CURRENT' NOT NULL,
	"currency_code" "currency_code" DEFAULT 'USD' NOT NULL,
	"status" "account_status" DEFAULT 'ACTIVE' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"default_necessity_level" "necessity_level"
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"category_id" integer,
	"necessity_level" "necessity_level",
	"income_account_id" integer,
	"income_amount" numeric(14, 2),
	"income_currency" "currency_code",
	"outcome_account_id" integer,
	"outcome_amount" numeric(14, 2),
	"outcome_currency" "currency_code",
	"comment" text
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_income_account_id_accounts_id_fk" FOREIGN KEY ("income_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_outcome_account_id_accounts_id_fk" FOREIGN KEY ("outcome_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;