LOCK TABLE profiles, accounts, transactions, spheres, allocations IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_allocation_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.reallocation_id IS NOT NULL OR NEW.reallocation_id IS NOT NULL) AND
    (OLD.profile_id, OLD.transaction_id, OLD.opening_account_id, OLD.reallocation_id)
    IS DISTINCT FROM (NEW.profile_id, NEW.transaction_id, NEW.opening_account_id, NEW.reallocation_id) THEN
    RAISE EXCEPTION 'Allocation source and profile are fixed' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS allocations_source_guard ON allocations;
--> statement-breakpoint
CREATE TRIGGER allocations_source_guard BEFORE UPDATE ON allocations
FOR EACH ROW EXECUTE FUNCTION guard_allocation_source();
--> statement-breakpoint
-- Deferred until both sides have been inserted/updated/deleted. This also guards direct SQL and
-- profile cascades; no half-operation can commit, even when its rows arrive in separate statements.
CREATE OR REPLACE FUNCTION guard_reallocation_pair() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE link uuid; total integer; valid boolean;
BEGIN
  link := CASE WHEN TG_OP='DELETE' THEN OLD.reallocation_id ELSE NEW.reallocation_id END;
  IF link IS NULL THEN RETURN NULL; END IF;
  SELECT count(*), count(*)=2 AND count(DISTINCT profile_id)=1
    AND count(DISTINCT sphere_id)=2 AND count(DISTINCT currency_code)=1
    AND count(DISTINCT created_at)=1 AND sum(amount)=0 AND bool_and(amount<>0)
    AND (count(deleted_at)=0 OR (count(deleted_at)=2 AND min(deleted_at)=max(deleted_at)))
    INTO total,valid FROM allocations WHERE reallocation_id=link;
  IF total<>0 AND valid IS NOT TRUE THEN
    RAISE EXCEPTION 'Reallocation must contain two balanced sides in one profile and currency' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS allocations_reallocation_pair ON allocations;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER allocations_reallocation_pair
AFTER INSERT OR UPDATE OR DELETE ON allocations DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION guard_reallocation_pair();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION maintain_operating_sphere() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO spheres (id,profile_id,updated_at,deleted_at) VALUES (NEW.id,NEW.id,NEW.updated_at,NEW.deleted_at)
  ON CONFLICT (id) DO UPDATE SET updated_at=EXCLUDED.updated_at,deleted_at=EXCLUDED.deleted_at;
  IF NEW.deleted_at IS NOT NULL THEN
    UPDATE spheres SET deleted_at=NEW.deleted_at,updated_at=NEW.updated_at
      WHERE profile_id=NEW.id AND id<>NEW.id AND deleted_at IS NULL;
    UPDATE allocations SET deleted_at=NEW.deleted_at,updated_at=NEW.updated_at
      WHERE profile_id=NEW.id AND reallocation_id IS NOT NULL AND deleted_at IS NULL;
  END IF;
  RETURN NEW;
END $$;
