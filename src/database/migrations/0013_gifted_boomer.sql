-- Fence writers through backfill and trigger installation, including still-running older clients.
LOCK TABLE "profiles", "accounts", "transactions" IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
CREATE TABLE "allocations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"profile_id" uuid NOT NULL,
	"sphere_id" uuid NOT NULL,
	"transaction_id" uuid,
	"opening_account_id" uuid,
	"amount" numeric(14, 2) NOT NULL,
	"currency_code" "currency_code" NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "allocations_transaction_id_unique" UNIQUE("transaction_id"),
	CONSTRAINT "allocations_opening_account_id_unique" UNIQUE("opening_account_id"),
	CONSTRAINT "allocations_source_check" CHECK (("allocations"."transaction_id" is null) <> ("allocations"."opening_account_id" is null)),
	CONSTRAINT "allocations_operating_check" CHECK ("allocations"."sphere_id" = "allocations"."profile_id")
);
--> statement-breakpoint
CREATE TABLE "spheres" (
	"id" uuid PRIMARY KEY NOT NULL,
	"profile_id" uuid NOT NULL,
	"name" text DEFAULT 'Operating' NOT NULL,
	"type" text DEFAULT 'OPERATING' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "spheres_profile_id_unique" UNIQUE("profile_id"),
	CONSTRAINT "spheres_system_check" CHECK ("spheres"."id" = "spheres"."profile_id" and "spheres"."name" = 'Operating' and "spheres"."type" = 'OPERATING')
);
--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_sphere_id_spheres_id_fk" FOREIGN KEY ("sphere_id") REFERENCES "public"."spheres"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_opening_account_id_accounts_id_fk" FOREIGN KEY ("opening_account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spheres" ADD CONSTRAINT "spheres_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "allocations_profile_id_updated_at_id_idx" ON "allocations" USING btree ("profile_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "spheres_profile_id_updated_at_id_idx" ON "spheres" USING btree ("profile_id","updated_at","id");
--> statement-breakpoint
-- Stable source identities let server backfill and queued legacy writes converge on one record.
CREATE FUNCTION financial_allocation_id(kind text, source_id uuid) RETURNS uuid
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT (substr(h,1,8)||'-'||substr(h,9,4)||'-8'||substr(h,14,3)||'-a'||substr(h,18,3)||'-'||substr(h,21,12))::uuid
  FROM (SELECT encode(sha256(convert_to(kind||':'||source_id::text,'UTF8')),'hex') h) digest
$$;
--> statement-breakpoint
-- Never invent a currency or a profile for orphaned historical money.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM transactions t LEFT JOIN accounts a ON a.id=t.account_id
    WHERE a.id IS NULL OR a.profile_id IS DISTINCT FROM t.profile_id) THEN
    RAISE EXCEPTION 'Operating backfill requires every transaction to have an account in its profile';
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO spheres (id,profile_id,updated_at,deleted_at)
SELECT id,id,now(),deleted_at FROM profiles;
--> statement-breakpoint
INSERT INTO allocations (id,profile_id,sphere_id,opening_account_id,amount,currency_code,created_at,updated_at,deleted_at)
SELECT financial_allocation_id('opening',a.id),a.profile_id,a.profile_id,a.id,a.initial_balance,a.currency_code,to_timestamp(0),now(),coalesce(a.deleted_at,p.deleted_at)
FROM accounts a JOIN profiles p ON p.id=a.profile_id;
--> statement-breakpoint
INSERT INTO allocations (id,profile_id,sphere_id,transaction_id,amount,currency_code,created_at,updated_at,deleted_at)
SELECT financial_allocation_id('transaction',t.id),t.profile_id,t.profile_id,t.id,t.amount,a.currency_code,t.created_at,now(),coalesce(t.deleted_at,a.deleted_at,p.deleted_at)
FROM transactions t JOIN accounts a ON a.id=t.account_id JOIN profiles p ON p.id=t.profile_id;
--> statement-breakpoint
CREATE FUNCTION maintain_operating_sphere() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO spheres (id,profile_id,updated_at,deleted_at) VALUES (NEW.id,NEW.id,NEW.updated_at,NEW.deleted_at)
  ON CONFLICT (id) DO UPDATE SET updated_at=EXCLUDED.updated_at,deleted_at=EXCLUDED.deleted_at;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER profiles_operating AFTER INSERT OR UPDATE OF name,deleted_at ON profiles
FOR EACH ROW EXECUTE FUNCTION maintain_operating_sphere();
--> statement-breakpoint
CREATE FUNCTION maintain_opening_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE profile_deleted timestamptz;
BEGIN
  IF NEW.profile_id IS NULL THEN RETURN NEW; END IF;
  SELECT deleted_at INTO profile_deleted FROM profiles WHERE id=NEW.profile_id;
  -- The attributable opening amount is a cumulative record. Changing it applies the signed
  -- difference to Operating; it never creates an income transaction or repeats a retry's delta.
  INSERT INTO allocations (id,profile_id,sphere_id,opening_account_id,amount,currency_code,created_at,updated_at,deleted_at)
  VALUES (financial_allocation_id('opening',NEW.id),NEW.profile_id,NEW.profile_id,NEW.id,NEW.initial_balance,NEW.currency_code,to_timestamp(0),NEW.updated_at,coalesce(NEW.deleted_at,profile_deleted))
  ON CONFLICT (id) DO UPDATE SET amount=EXCLUDED.amount,currency_code=EXCLUDED.currency_code,updated_at=EXCLUDED.updated_at,deleted_at=EXCLUDED.deleted_at;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER accounts_opening_allocation AFTER INSERT OR UPDATE OF initial_balance,currency_code,deleted_at ON accounts
FOR EACH ROW EXECUTE FUNCTION maintain_opening_allocation();
--> statement-breakpoint
CREATE FUNCTION maintain_transaction_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE account_currency currency_code; account_profile uuid; account_deleted timestamptz; profile_deleted timestamptz;
BEGIN
  SELECT currency_code,profile_id,deleted_at INTO account_currency,account_profile,account_deleted FROM accounts WHERE id=NEW.account_id;
  IF account_currency IS NULL OR account_profile IS DISTINCT FROM NEW.profile_id THEN
    RAISE EXCEPTION 'Transaction allocation requires an account in its profile';
  END IF;
  SELECT deleted_at INTO profile_deleted FROM profiles WHERE id=NEW.profile_id;
  INSERT INTO allocations (id,profile_id,sphere_id,transaction_id,amount,currency_code,created_at,updated_at,deleted_at)
  VALUES (financial_allocation_id('transaction',NEW.id),NEW.profile_id,NEW.profile_id,NEW.id,NEW.amount,account_currency,NEW.created_at,NEW.updated_at,coalesce(NEW.deleted_at,account_deleted,profile_deleted))
  ON CONFLICT (id) DO UPDATE SET amount=EXCLUDED.amount,currency_code=EXCLUDED.currency_code,created_at=EXCLUDED.created_at,updated_at=EXCLUDED.updated_at,deleted_at=EXCLUDED.deleted_at;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER transactions_allocation AFTER INSERT OR UPDATE ON transactions
FOR EACH ROW EXECUTE FUNCTION maintain_transaction_allocation();
