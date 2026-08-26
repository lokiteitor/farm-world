-- Farm stock: the aggregate that carries the CHECK, and the breakdown behind it.
--
-- Why two tables and not one. The price of a harvest belongs to the crop, so stock has
-- to remember which crop it came from; but capacity belongs to the category, and the
-- whole safety model of the storage columns this replaces rested on a single row per
-- (farm, category) that two concurrent harvests both have to touch. Keeping only the
-- breakdown would lose that: two harvests of two different crops into the same cold
-- store would each see room the other was about to take. So the aggregate stays, keeps
-- the CHECK, and a trigger recomputes it from the breakdown.

-- ---------------------------------------------------------------------------
-- 1. The stock item type
-- ---------------------------------------------------------------------------

-- A pile is a crop, or timber. CREATE TYPE, unlike ALTER TYPE ... ADD VALUE, is usable
-- in the transaction that runs it, so this file may go on to use the values.
CREATE TYPE "StockItem" AS ENUM (
    'MAIZ',
    'WHEAT',
    'CEBADA',
    'AVENA',
    'CENTENO',
    'SORGO',
    'TRITICALE',
    'MIJO',
    'QUINOA',
    'AMARANTO',
    'FRIJOL',
    'GARBANZO',
    'LENTEJA',
    'CHICHARO',
    'HABA',
    'SOYA',
    'CACAHUATE',
    'CANOLA',
    'GIRASOL',
    'AJONJOLI',
    'LINAZA',
    'MOSTAZA',
    'ALGODON',
    'TABACO',
    'PAPA',
    'JICAMA',
    'BETABEL',
    'ZANAHORIA',
    'RABANO',
    'CHIRIVIA',
    'CEBOLLA',
    'AJO',
    'LECHUGA',
    'ESPINACA',
    'ACELGA',
    'COL',
    'COLIFLOR',
    'BROCOLI',
    'PEPINO',
    'CALABACITA',
    'CALABAZA',
    'MELON',
    'SANDIA',
    'BERENJENA',
    'TOMATE',
    'TOMATILLO',
    'CHILE',
    'PIMIENTO',
    'EJOTE',
    'CILANTRO',
    'PEREJIL',
    'ALBAHACA',
    'MANZANILLA',
    'CEMPASUCHIL',
    'GIRASOL_ORNAMENTAL',
    'CRISANTEMO',
    'TULIPAN',
    'DALIA',
    'MAIZ_FORRAJERO',
    'SORGO_FORRAJERO',
    'AVENA_FORRAJERA',
    'CENTENO_FORRAJERO',
    'WOOD'
);

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------

CREATE TABLE "farm_storage" (
    "farmId"        UUID NOT NULL,
    "category"      "StorageResource" NOT NULL,
    "storedUnits"   INTEGER NOT NULL DEFAULT 0,
    "reservedUnits" INTEGER NOT NULL DEFAULT 0,
    "capacityUnits" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "farm_storage_pkey" PRIMARY KEY ("farmId", "category")
);

ALTER TABLE "farm_storage"
    ADD CONSTRAINT "farm_storage_farmId_fkey"
    FOREIGN KEY ("farmId") REFERENCES "farms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The same safety net `farms_stock_check` was, one category at a time. Still not the
-- primary defence: the primary defence is reserving capacity when a harvest is
-- assigned, so an overflow is an actionable rejection, plus a single bounded statement
-- at completion that computes what is accepted and wastes the rest (GDD sections 83
-- and 97). A violation inside a queue job would retry for ever.
ALTER TABLE "farm_storage"
    ADD CONSTRAINT "farm_storage_check" CHECK (
        "storedUnits" >= 0
        AND "reservedUnits" >= 0
        AND "capacityUnits" >= 0
        AND "storedUnits" + "reservedUnits" <= "capacityUnits"
    );

CREATE TABLE "farm_stock" (
    "farmId"        UUID NOT NULL,
    "item"          "StockItem" NOT NULL,
    "storedUnits"   INTEGER NOT NULL DEFAULT 0,
    "reservedUnits" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "farm_stock_pkey" PRIMARY KEY ("farmId", "item")
);

ALTER TABLE "farm_stock"
    ADD CONSTRAINT "farm_stock_farmId_fkey"
    FOREIGN KEY ("farmId") REFERENCES "farms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "farm_stock"
    ADD CONSTRAINT "farm_stock_check" CHECK (
        "storedUnits" >= 0 AND "reservedUnits" >= 0
    );

CREATE INDEX "farm_stock_farmId_idx" ON "farm_stock"("farmId");

-- ---------------------------------------------------------------------------
-- 3. Which category a pile belongs to
-- ---------------------------------------------------------------------------

-- The mapping lives in shared/config/crops/families.ts, and it is duplicated here for
-- the same reason the capacity trigger duplicates the building catalogue: a trigger
-- cannot import TypeScript, and the coherence test cross checks the two.
CREATE FUNCTION farm_world_stock_item_category("item" "StockItem")
RETURNS "StorageResource"
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN "item" = 'WOOD' THEN 'WOOD_M3'::"StorageResource"
        WHEN "item" IN ('MAIZ', 'WHEAT', 'CEBADA', 'AVENA', 'CENTENO', 'SORGO', 'TRITICALE', 'MIJO', 'QUINOA', 'AMARANTO', 'FRIJOL', 'GARBANZO', 'LENTEJA', 'CHICHARO', 'HABA', 'SOYA', 'CACAHUATE', 'CANOLA', 'GIRASOL', 'AJONJOLI', 'LINAZA', 'MOSTAZA')
            THEN 'GRAIN_LITERS'::"StorageResource"
        WHEN "item" IN ('MAIZ_FORRAJERO', 'SORGO_FORRAJERO', 'AVENA_FORRAJERA', 'CENTENO_FORRAJERO')
            THEN 'FORAGE_LITERS'::"StorageResource"
        WHEN "item" IN ('ALGODON', 'TABACO')
            THEN 'INDUSTRIAL_LITERS'::"StorageResource"
        ELSE 'PRODUCE_LITERS'::"StorageResource"
    END;
$$;

-- ---------------------------------------------------------------------------
-- 4. The aggregate follows the breakdown
-- ---------------------------------------------------------------------------

-- Recomputed and not incremented, like the capacity trigger: the statement is one
-- aggregate per affected (farm, category) and a recomputation cannot drift.
CREATE FUNCTION farm_world_sync_farm_storage_totals() RETURNS TRIGGER
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
        INSERT INTO "farm_storage" ("farmId", "category", "storedUnits", "reservedUnits")
        SELECT pairs."farmId",
               pairs."category",
               COALESCE(SUM(s."storedUnits"), 0)::INTEGER,
               COALESCE(SUM(s."reservedUnits"), 0)::INTEGER
          FROM "farm_stock" s
         WHERE s."farmId" = pairs."farmId"
           AND farm_world_stock_item_category(s."item") = pairs."category"
        ON CONFLICT ("farmId", "category") DO UPDATE
            SET "storedUnits" = EXCLUDED."storedUnits",
                "reservedUnits" = EXCLUDED."reservedUnits";
    END LOOP;

    RETURN NULL;
END;
$$;

CREATE TRIGGER "farm_stock_storage_totals"
    AFTER INSERT OR DELETE OR UPDATE OF "farmId", "item", "storedUnits", "reservedUnits"
    ON "farm_stock"
    FOR EACH ROW EXECUTE FUNCTION farm_world_sync_farm_storage_totals();

-- ---------------------------------------------------------------------------
-- 5. Capacity follows the buildings, now into farm_storage
-- ---------------------------------------------------------------------------

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
        INSERT INTO "farm_storage" ("farmId", "category", "capacityUnits")
        SELECT farm, c.category, COALESCE((
                   SELECT SUM(b."capacityStorageUnits")
                     FROM "buildings" b
                    WHERE b."farmId" = farm
                      AND b."disposedGameMs" IS NULL
                      AND b."storageResource" = c.category
               ), 0)::INTEGER
          FROM unnest(enum_range(NULL::"StorageResource")) AS c(category)
         ORDER BY c.category
        ON CONFLICT ("farmId", "category") DO UPDATE
            SET "capacityUnits" = EXCLUDED."capacityUnits";
    END LOOP;

    RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Carry the existing stock across, then drop the columns
-- ---------------------------------------------------------------------------

-- Reservations of tasks in flight travel for free: they were already counted inside
-- `reservedWheatLiters` and `reservedWoodDm3`.
INSERT INTO "farm_storage" ("farmId", "category", "storedUnits", "reservedUnits", "capacityUnits")
SELECT "id", 'GRAIN_LITERS'::"StorageResource", "storedWheatLiters", "reservedWheatLiters",
       "capacityWheatLiters"
  FROM "farms"
UNION ALL
SELECT "id", 'WOOD_M3'::"StorageResource", "storedWoodDm3", "reservedWoodDm3", "capacityWoodDm3"
  FROM "farms";

INSERT INTO "farm_stock" ("farmId", "item", "storedUnits", "reservedUnits")
SELECT "id", 'WHEAT'::"StockItem", "storedWheatLiters", "reservedWheatLiters"
  FROM "farms"
 WHERE "storedWheatLiters" + "reservedWheatLiters" > 0
UNION ALL
SELECT "id", 'WOOD'::"StockItem", "storedWoodDm3", "reservedWoodDm3"
  FROM "farms"
 WHERE "storedWoodDm3" + "reservedWoodDm3" > 0;

-- Every category a farm can hold needs its row, so a first harvest into an empty
-- category updates a row instead of having to create one under contention.
INSERT INTO "farm_storage" ("farmId", "category")
SELECT f."id", c.category
  FROM "farms" f
 CROSS JOIN unnest(enum_range(NULL::"StorageResource")) AS c(category)
ON CONFLICT ("farmId", "category") DO NOTHING;

ALTER TABLE "farms" DROP CONSTRAINT "farms_stock_check";
ALTER TABLE "farms"
    DROP COLUMN "storedWheatLiters",
    DROP COLUMN "reservedWheatLiters",
    DROP COLUMN "capacityWheatLiters",
    DROP COLUMN "storedWoodDm3",
    DROP COLUMN "reservedWoodDm3",
    DROP COLUMN "capacityWoodDm3";
