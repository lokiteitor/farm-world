-- The two storage triggers update the aggregate instead of upserting it.
--
-- Upserting was wrong in a way that only shows on the way out. Deleting a farm cascades to
-- `farm_stock`, the delete fires the totals trigger, and the trigger inserted the aggregate
-- row back for a farm that was in the middle of being deleted: the insert then violated the
-- foreign key it had just been cascaded through. The same reinsertion could also recreate a
-- row with `capacityUnits` at its default of zero while stock was being written into it,
-- which trips `farm_storage_check` for a reason that has nothing to do with capacity.
--
-- An UPDATE has neither problem: the row always exists, because `farms_seed_storage`
-- creates all of them with the farm, and an UPDATE that matches nothing is a no-op, which
-- is exactly the right behaviour for a farm on its way out.

CREATE OR REPLACE FUNCTION farm_world_sync_farm_storage_totals() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    pairs RECORD;
BEGIN
    FOR pairs IN
        SELECT DISTINCT "farmId", "category"
          FROM (
              SELECT OLD."farmId" AS "farmId",
                     farm_world_stock_item_category(OLD."item") AS "category"
               WHERE TG_OP <> 'INSERT'
              UNION
              SELECT NEW."farmId",
                     farm_world_stock_item_category(NEW."item")
               WHERE TG_OP <> 'DELETE'
          ) AS touched
         -- Ascending order, the canonical lock order of plan section 6.3.
         ORDER BY "farmId", "category"
    LOOP
        UPDATE "farm_storage" t
           SET "storedUnits" = COALESCE((
                   SELECT SUM(s."storedUnits")
                     FROM "farm_stock" s
                    WHERE s."farmId" = pairs."farmId"
                      AND farm_world_stock_item_category(s."item") = pairs."category"
               ), 0)::INTEGER,
               "reservedUnits" = COALESCE((
                   SELECT SUM(s."reservedUnits")
                     FROM "farm_stock" s
                    WHERE s."farmId" = pairs."farmId"
                      AND farm_world_stock_item_category(s."item") = pairs."category"
               ), 0)::INTEGER
         WHERE t."farmId" = pairs."farmId"
           AND t."category" = pairs."category";
    END LOOP;

    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION farm_world_sync_farm_storage_capacity() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    affected UUID[] := ARRAY[]::UUID[];
    farm UUID;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        affected := array_append(affected, OLD."farmId");
    END IF;
    IF TG_OP <> 'DELETE' AND NOT (NEW."farmId" = ANY (affected)) THEN
        affected := array_append(affected, NEW."farmId");
    END IF;

    -- Ascending identifier order, the canonical lock order of plan section 6.3.
    SELECT array_agg(f ORDER BY f) INTO affected FROM unnest(affected) AS f;

    FOREACH farm IN ARRAY affected
    LOOP
        UPDATE "farm_storage" t
           SET "capacityUnits" = COALESCE((
                   SELECT SUM(b."capacityStorageUnits")
                     FROM "buildings" b
                    WHERE b."farmId" = farm
                      AND b."disposedGameMs" IS NULL
                      AND b."storageResource" = t."category"
               ), 0)::INTEGER
         WHERE t."farmId" = farm;
    END LOOP;

    RETURN NULL;
END;
$$;
