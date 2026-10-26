LOCK TABLE profiles, accounts, transactions, spheres, allocations IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
-- History is monotonic and survives allocation tombstone collection. Operating is permanent
-- regardless of history; only named spheres need this evidence.
CREATE OR REPLACE FUNCTION guard_sphere_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_deleted timestamptz; parent_exists boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT true, deleted_at INTO parent_exists, parent_deleted FROM profiles WHERE id=OLD.profile_id;
    IF parent_exists IS NOT TRUE OR parent_deleted IS NOT NULL THEN RETURN OLD; END IF;
    IF OLD.type = 'OPERATING' OR OLD.has_history OR EXISTS (SELECT 1 FROM allocations WHERE sphere_id=OLD.id) THEN
      RAISE EXCEPTION 'Only unused named spheres may be deleted' USING ERRCODE='23514';
    END IF;
    RETURN OLD;
  END IF;
  SELECT deleted_at INTO parent_deleted FROM profiles WHERE id=NEW.profile_id;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.type IS DISTINCT FROM OLD.type OR NEW.profile_id IS DISTINCT FROM OLD.profile_id THEN
      RAISE EXCEPTION 'Sphere type and profile are fixed' USING ERRCODE='23514';
    END IF;
    NEW.has_history := OLD.has_history OR NEW.has_history;
    IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
      RAISE EXCEPTION 'A deleted sphere cannot be restored' USING ERRCODE='23514';
    END IF;
  END IF;
  IF parent_deleted IS NOT NULL THEN
    IF NEW.deleted_at IS NULL THEN
      RAISE EXCEPTION 'Sphere profile is deleted' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.deleted_at IS NOT NULL AND (TG_OP='INSERT' OR OLD.deleted_at IS NULL) THEN
    IF NEW.type='OPERATING' OR NEW.has_history OR EXISTS (SELECT 1 FROM allocations WHERE sphere_id=NEW.id) THEN
      RAISE EXCEPTION 'Only unused named spheres may be deleted' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW.archived AND (TG_OP='INSERT' OR NOT OLD.archived) AND EXISTS (
    SELECT 1 FROM allocations WHERE sphere_id=NEW.id AND deleted_at IS NULL
    GROUP BY currency_code HAVING sum(amount) <> 0
  ) THEN
    RAISE EXCEPTION 'Every currency balance must be zero before archiving' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS spheres_lifecycle ON spheres;
--> statement-breakpoint
CREATE TRIGGER spheres_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON spheres
FOR EACH ROW EXECUTE FUNCTION guard_sphere_lifecycle();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_allocation_sphere() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE purpose spheres%ROWTYPE; source_purpose spheres%ROWTYPE; parent_deleted timestamptz;
BEGIN
  IF TG_OP='DELETE' THEN
    SELECT * INTO purpose FROM spheres WHERE id=OLD.sphere_id FOR UPDATE;
    SELECT deleted_at INTO parent_deleted FROM profiles WHERE id=OLD.profile_id;
    IF parent_deleted IS NULL AND purpose.archived AND OLD.deleted_at IS NULL AND OLD.amount <> 0 THEN
      RAISE EXCEPTION 'Archived sphere history cannot change' USING ERRCODE='23514';
    END IF;
    RETURN OLD;
  END IF;
  -- Sphere locks serialize allocation writes with archive/delete checks. Lock both sides in id
  -- order when attribution changes; all application writers also hold the owning profile lock.
  IF TG_OP='UPDATE' AND OLD.sphere_id <> NEW.sphere_id THEN
    PERFORM id FROM spheres WHERE id IN (OLD.sphere_id,NEW.sphere_id) ORDER BY id FOR UPDATE;
    SELECT * INTO source_purpose FROM spheres WHERE id=OLD.sphere_id;
    IF source_purpose.archived AND OLD.deleted_at IS NULL THEN
      RAISE EXCEPTION 'Archived sphere history cannot change' USING ERRCODE='23514';
    END IF;
  END IF;
  SELECT * INTO purpose FROM spheres WHERE id=NEW.sphere_id FOR UPDATE;
  IF purpose.id IS NULL OR purpose.profile_id <> NEW.profile_id THEN
    RAISE EXCEPTION 'Allocation sphere must belong to its profile' USING ERRCODE='23514';
  END IF;
  SELECT deleted_at INTO parent_deleted FROM profiles WHERE id=NEW.profile_id;
  IF parent_deleted IS NULL AND (purpose.archived OR purpose.deleted_at IS NOT NULL) THEN
    IF TG_OP='INSERT' OR (OLD.amount,OLD.currency_code,OLD.sphere_id,OLD.deleted_at)
      IS DISTINCT FROM (NEW.amount,NEW.currency_code,NEW.sphere_id,NEW.deleted_at) THEN
      RAISE EXCEPTION 'Archived or deleted spheres cannot receive changed allocations' USING ERRCODE='23514';
    END IF;
  END IF;
  IF purpose.type <> 'OPERATING' AND NOT purpose.has_history THEN
    UPDATE spheres SET has_history=true, updated_at=now() WHERE id=purpose.id;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS allocations_sphere_guard ON allocations;
--> statement-breakpoint
CREATE TRIGGER allocations_sphere_guard BEFORE INSERT OR UPDATE OR DELETE ON allocations
FOR EACH ROW EXECUTE FUNCTION guard_allocation_sphere();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION maintain_operating_sphere() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO spheres (id,profile_id,updated_at,deleted_at) VALUES (NEW.id,NEW.id,NEW.updated_at,NEW.deleted_at)
  ON CONFLICT (id) DO UPDATE SET updated_at=EXCLUDED.updated_at,deleted_at=EXCLUDED.deleted_at;
  IF NEW.deleted_at IS NOT NULL THEN
    UPDATE spheres SET deleted_at=NEW.deleted_at,updated_at=NEW.updated_at
      WHERE profile_id=NEW.id AND id<>NEW.id AND deleted_at IS NULL;
  END IF;
  RETURN NEW;
END $$;
