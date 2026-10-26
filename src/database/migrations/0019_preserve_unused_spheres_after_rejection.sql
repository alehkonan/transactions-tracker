-- Rejected tombstones never assigned money. Accepted history is monotonic in has_history,
-- so only live allocations are needed as fallback evidence while checking unused spheres.
CREATE OR REPLACE FUNCTION guard_sphere_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_deleted timestamptz; parent_exists boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT true, deleted_at INTO parent_exists, parent_deleted FROM profiles WHERE id=OLD.profile_id;
    IF parent_exists IS NOT TRUE OR parent_deleted IS NOT NULL THEN RETURN OLD; END IF;
    IF OLD.type = 'OPERATING' OR OLD.has_history OR EXISTS (SELECT 1 FROM allocations WHERE sphere_id=OLD.id AND deleted_at IS NULL) THEN
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
    IF NEW.type='OPERATING' OR NEW.has_history OR EXISTS (SELECT 1 FROM allocations WHERE sphere_id=NEW.id AND deleted_at IS NULL) THEN
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
