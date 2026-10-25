-- A rejected offline reservation has no active financial effect. Retain its two tombstones
-- for receipt settlement/replay without changing a closed sphere or manufacturing history.
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
    IF (TG_OP='INSERT' AND NOT (NEW.reallocation_id IS NOT NULL AND NEW.deleted_at IS NOT NULL))
      OR (TG_OP='UPDATE' AND (OLD.amount,OLD.currency_code,OLD.sphere_id,OLD.deleted_at)
      IS DISTINCT FROM (NEW.amount,NEW.currency_code,NEW.sphere_id,NEW.deleted_at)) THEN
      RAISE EXCEPTION 'Archived or deleted spheres cannot receive changed allocations' USING ERRCODE='23514';
    END IF;
  END IF;
  IF purpose.type <> 'OPERATING' AND NOT purpose.has_history
    AND NOT (TG_OP='INSERT' AND NEW.reallocation_id IS NOT NULL AND NEW.deleted_at IS NOT NULL) THEN
    UPDATE spheres SET has_history=true, updated_at=now() WHERE id=purpose.id;
  END IF;
  RETURN NEW;
END $$;
