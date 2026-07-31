CREATE TYPE "public"."account_status" AS ENUM('ACTIVE', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."account_type" AS ENUM('CURRENT', 'SAVING');--> statement-breakpoint
CREATE TYPE "public"."currency_code" AS ENUM('USD', 'GEL');--> statement-breakpoint
CREATE TYPE "public"."necessity_level" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'ESSENTIAL');--> statement-breakpoint
CREATE TYPE "public"."transaction_type" AS ENUM('INCOME', 'OUTCOME', 'TRANSFER', 'DEBT');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"balance" real DEFAULT 0 NOT NULL,
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
	"type" "transaction_type" NOT NULL,
	"amount" real NOT NULL,
	"src_account_id" integer,
	"dest_account_id" integer,
	"category_id" integer,
	"necessity_level" "necessity_level"
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_src_account_id_accounts_id_fk" FOREIGN KEY ("src_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_dest_account_id_accounts_id_fk" FOREIGN KEY ("dest_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;