-- Serialize with existing financial writers throughout lifecycle guard installation.
LOCK TABLE "profiles", "accounts", "transactions", "spheres", "allocations" IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
ALTER TABLE "spheres" DROP CONSTRAINT "spheres_profile_id_unique";--> statement-breakpoint
ALTER TABLE "allocations" DROP CONSTRAINT "allocations_operating_check";--> statement-breakpoint
ALTER TABLE "spheres" DROP CONSTRAINT "spheres_system_check";--> statement-breakpoint
ALTER TABLE "spheres" ADD COLUMN "archived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "spheres" ADD COLUMN "has_history" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "spheres" ADD CONSTRAINT "spheres_name_check" CHECK (length(trim("spheres"."name")) > 0);--> statement-breakpoint
ALTER TABLE "spheres" ADD CONSTRAINT "spheres_system_check" CHECK (("spheres"."type" = 'OPERATING' and "spheres"."id" = "spheres"."profile_id" and "spheres"."name" = 'Operating' and not "spheres"."archived") or ("spheres"."type" in ('FUNDS', 'CAPITAL') and "spheres"."id" <> "spheres"."profile_id"));

