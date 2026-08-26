-- Every farm carries a row per storage category from the instant it exists.
--
-- Without this a farm created after the tables existed had no aggregate rows at all, and
-- the first harvest into it found nothing to lock. The rows are what the writers serialise
-- on, so they cannot be created lazily by the writer that needs one: two concurrent
-- harvests would both try to insert it and the loser would either wait on a row it cannot
-- see yet or take a lock the winner already released.
--
-- The capacity trigger on `buildings` also inserts them, but only when a store is built,
-- which is not the state a farm starts in.

CREATE FUNCTION farm_world_seed_farm_storage() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO "farm_storage" ("farmId", "category")
    SELECT NEW."id", c.category
      FROM unnest(enum_range(NULL::"StorageResource")) AS c(category)
     -- Ascending order, the canonical lock order of plan section 6.3.
     ORDER BY c.category
    ON CONFLICT ("farmId", "category") DO NOTHING;
    RETURN NULL;
END;
$$;

CREATE TRIGGER "farms_seed_storage"
    AFTER INSERT ON "farms"
    FOR EACH ROW EXECUTE FUNCTION farm_world_seed_farm_storage();

-- Farms that already exist, including any created between the previous migration and this
-- one.
INSERT INTO "farm_storage" ("farmId", "category")
SELECT f."id", c.category
  FROM "farms" f
 CROSS JOIN unnest(enum_range(NULL::"StorageResource")) AS c(category)
ON CONFLICT ("farmId", "category") DO NOTHING;
