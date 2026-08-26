-- Storage categories and the buildings that grant them.
--
-- Enum DDL only, for the same reason as the previous file: the tables that use these
-- values are created in the next one.
--
-- `WHEAT_LITERS` is renamed rather than replaced, so every row that already references
-- it (the silo's `storageResource`, the ledger, the tasks in flight) follows without a
-- data conversion. It stops being "the wheat store" and becomes "the grain store",
-- which is what a silo always was.
ALTER TYPE "StorageResource" RENAME VALUE 'WHEAT_LITERS' TO 'GRAIN_LITERS';
ALTER TYPE "StorageResource" ADD VALUE 'FORAGE_LITERS' BEFORE 'WOOD_M3';
ALTER TYPE "StorageResource" ADD VALUE 'PRODUCE_LITERS' BEFORE 'WOOD_M3';
ALTER TYPE "StorageResource" ADD VALUE 'INDUSTRIAL_LITERS' BEFORE 'WOOD_M3';

-- One store per category: a building granting room to two categories would either add
-- up litres of unlike goods against one counter or hand out its capacity twice.
ALTER TYPE "BuildingType" ADD VALUE 'HAY_BARN';
ALTER TYPE "BuildingType" ADD VALUE 'COLD_STORE';
ALTER TYPE "BuildingType" ADD VALUE 'WAREHOUSE';
