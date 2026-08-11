-- CreateEnum
CREATE TYPE "TerrainType" AS ENUM ('GRASS', 'FOREST', 'MOUNTAIN', 'WATER');

-- CreateEnum
CREATE TYPE "LandUse" AS ENUM ('NONE', 'OWNED', 'FIELD', 'FOREST_PLOT', 'BUILDING', 'ROAD');

-- CreateEnum
CREATE TYPE "CropCycleState" AS ENUM ('VIRGIN', 'PLOWED', 'CULTIVATED', 'SEEDED', 'GERMINATING', 'GROWING', 'READY_TO_HARVEST', 'HARVESTED');

-- CreateEnum
CREATE TYPE "SoilCondition" AS ENUM ('UNTOUCHED', 'PLOWED', 'CULTIVATED', 'COMPACTED');

-- CreateEnum
CREATE TYPE "CropId" AS ENUM ('WHEAT');

-- CreateEnum
CREATE TYPE "MachineType" AS ENUM ('TRACTOR', 'PLOW', 'CULTIVATOR', 'SEEDER', 'HARVESTER', 'TRAILER', 'HARVESTER_FORESTRY', 'FORWARDER');

-- CreateEnum
CREATE TYPE "MachineRole" AS ENUM ('POWERED', 'IMPLEMENT');

-- CreateEnum
CREATE TYPE "MachineStatus" AS ENUM ('IDLE', 'WORKING', 'BROKEN', 'IN_REPAIR');

-- CreateEnum
CREATE TYPE "WorkerStatus" AS ENUM ('IDLE', 'WORKING', 'TRAVELING', 'UNAVAILABLE', 'RESTING', 'INJURED');

-- CreateEnum
CREATE TYPE "TaskOperation" AS ENUM ('PLOW', 'CULTIVATE', 'SEED', 'HARVEST', 'FELL', 'REPLANT', 'CLEAR_LAND');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'CANCELED');

-- CreateEnum
CREATE TYPE "BuildingType" AS ENUM ('GARAGE', 'SILO', 'WORKER_HOME', 'WORKSHOP', 'WOOD_STORAGE');

-- CreateEnum
CREATE TYPE "StorageResource" AS ENUM ('WHEAT_LITERS', 'WOOD_M3');

-- CreateEnum
CREATE TYPE "TreeSpecies" AS ENUM ('PINE');

-- CreateEnum
CREATE TYPE "TreeStatus" AS ENUM ('STANDING', 'MARKED_FOR_HARVEST', 'FELLED');

-- CreateEnum
CREATE TYPE "PlayerStatus" AS ENUM ('ACTIVE', 'IN_DEBT', 'BANKRUPT');

-- CreateEnum
CREATE TYPE "LedgerType" AS ENUM ('LAND_PURCHASE', 'LAND_SALE', 'BUILDING_PURCHASE', 'BUILDING_SALE', 'MACHINE_PURCHASE', 'MACHINE_SALE', 'MACHINE_REPAIR', 'CROP_SALE', 'WOOD_SALE', 'HARVEST_WASTE', 'WORKER_WAGES', 'MACHINE_MAINTENANCE', 'MACHINE_OPERATING', 'OVERDRAFT_INTEREST', 'LIQUIDATION', 'COMPENSATION', 'SEED_PURCHASE');

-- CreateEnum
CREATE TYPE "ScheduledEventKind" AS ENUM ('TASK_COMPLETE', 'FIELD_ADVANCE_PHASE', 'MACHINE_REPAIR_COMPLETE', 'PLAYER_SETTLE_SWEEP', 'WORKER_POOL_REFRESH', 'FOREST_NOTIFY_MILESTONE');

-- CreateEnum
CREATE TYPE "ScheduledEventStatus" AS ENUM ('PENDING', 'PROCESSED', 'CANCELED');

-- CreateEnum
CREATE TYPE "GameEventType" AS ENUM ('CLOCK', 'PLAYER_UPSERTED', 'LEDGER_APPENDED', 'INVENTORY_UPSERTED', 'CHUNK_PATCHED', 'FARM_UPSERTED', 'BUILDING_UPSERTED', 'BUILDING_REMOVED', 'FIELD_UPSERTED', 'FIELD_REMOVED', 'MACHINE_UPSERTED', 'MACHINE_REMOVED', 'WORKER_UPSERTED', 'WORKER_REMOVED', 'WORKER_POOL_UPSERTED', 'TASK_UPSERTED', 'FOREST_PLOT_UPSERTED', 'FOREST_PLOT_REMOVED', 'TREES_UPSERTED', 'NOTICE');

-- CreateTable
CREATE TABLE "worlds" (
    "id" UUID NOT NULL,
    "seed" INTEGER NOT NULL,
    "generatorVersion" INTEGER NOT NULL,
    "chunkSize" INTEGER NOT NULL,
    "anchorRealMs" BIGINT NOT NULL,
    "anchorGameMs" BIGINT NOT NULL,
    "rateNum" INTEGER NOT NULL,
    "rateDen" INTEGER NOT NULL,
    "scheduleEpoch" INTEGER NOT NULL DEFAULT 0,
    "createdAtRealMs" BIGINT NOT NULL,

    CONSTRAINT "worlds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "world_time_segments" (
    "id" UUID NOT NULL,
    "worldId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "fromGameMs" BIGINT NOT NULL,
    "toGameMs" BIGINT NOT NULL,
    "fromRealMs" BIGINT NOT NULL,
    "toRealMs" BIGINT NOT NULL,
    "rateNum" INTEGER NOT NULL,
    "rateDen" INTEGER NOT NULL,

    CONSTRAINT "world_time_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "players" (
    "id" UUID NOT NULL,
    "worldId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "status" "PlayerStatus" NOT NULL DEFAULT 'ACTIVE',
    "balance" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "startedAtGameMs" BIGINT NOT NULL,
    "lastAccrualGameMs" BIGINT NOT NULL,
    "lastLoginGameMs" BIGINT NOT NULL,
    "lastSummaryGameMs" BIGINT NOT NULL,
    "ledgerSeq" INTEGER NOT NULL DEFAULT 0,
    "eventSeq" INTEGER NOT NULL DEFAULT 0,
    "spawnCellX" INTEGER,
    "spawnCellY" INTEGER,
    "createdAtRealMs" BIGINT NOT NULL,

    CONSTRAINT "players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "playerId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "replacedByTokenId" UUID,
    "issuedAtRealMs" BIGINT NOT NULL,
    "expiresAtRealMs" BIGINT NOT NULL,
    "revokedAtRealMs" BIGINT,
    "userAgent" TEXT,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chunks" (
    "id" UUID NOT NULL,
    "worldId" UUID NOT NULL,
    "chunkX" INTEGER NOT NULL,
    "chunkY" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAtRealMs" BIGINT NOT NULL,

    CONSTRAINT "chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "world_cells" (
    "id" UUID NOT NULL,
    "worldId" UUID NOT NULL,
    "chunkX" INTEGER NOT NULL,
    "chunkY" INTEGER NOT NULL,
    "idx" INTEGER NOT NULL,
    "cellX" INTEGER NOT NULL,
    "cellY" INTEGER NOT NULL,
    "generatedTerrain" "TerrainType" NOT NULL,
    "terrainOverride" "TerrainType",
    "ownerPlayerId" UUID,
    "landUse" "LandUse" NOT NULL DEFAULT 'NONE',
    "fieldId" UUID,
    "forestPlotId" UUID,
    "buildingId" UUID,
    "naturalTreeConsumed" BOOLEAN NOT NULL DEFAULT false,
    "updatedAtRealMs" BIGINT NOT NULL,

    CONSTRAINT "world_cells_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farms" (
    "id" UUID NOT NULL,
    "playerId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "storedWheatLiters" INTEGER NOT NULL DEFAULT 0,
    "reservedWheatLiters" INTEGER NOT NULL DEFAULT 0,
    "capacityWheatLiters" INTEGER NOT NULL DEFAULT 0,
    "storedWoodDm3" INTEGER NOT NULL DEFAULT 0,
    "reservedWoodDm3" INTEGER NOT NULL DEFAULT 0,
    "capacityWoodDm3" INTEGER NOT NULL DEFAULT 0,
    "createdAtGameMs" BIGINT NOT NULL,
    "disposedGameMs" BIGINT,

    CONSTRAINT "farms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buildings" (
    "id" UUID NOT NULL,
    "farmId" UUID NOT NULL,
    "playerId" UUID NOT NULL,
    "type" "BuildingType" NOT NULL,
    "originCellX" INTEGER NOT NULL,
    "originCellY" INTEGER NOT NULL,
    "widthCells" INTEGER NOT NULL,
    "heightCells" INTEGER NOT NULL,
    "purchasePrice" DECIMAL(20,4) NOT NULL,
    "capacityMachines" INTEGER NOT NULL DEFAULT 0,
    "capacityWorkers" INTEGER NOT NULL DEFAULT 0,
    "capacityStorageUnits" INTEGER NOT NULL DEFAULT 0,
    "storageResource" "StorageResource",
    "machineCount" INTEGER NOT NULL DEFAULT 0,
    "workerCount" INTEGER NOT NULL DEFAULT 0,
    "builtAtGameMs" BIGINT NOT NULL,
    "disposedGameMs" BIGINT,

    CONSTRAINT "buildings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fields" (
    "id" UUID NOT NULL,
    "playerId" UUID NOT NULL,
    "farmId" UUID,
    "name" TEXT NOT NULL,
    "cellCount" INTEGER NOT NULL,
    "cropId" "CropId",
    "cropCycleState" "CropCycleState" NOT NULL DEFAULT 'VIRGIN',
    "soilCondition" "SoilCondition" NOT NULL DEFAULT 'UNTOUCHED',
    "fertilityBp" INTEGER NOT NULL DEFAULT 10000,
    "fertilityUpdatedAtGameMs" BIGINT NOT NULL,
    "weedLevelBp" INTEGER NOT NULL DEFAULT 0,
    "weedLevelUpdatedAtGameMs" BIGINT NOT NULL,
    "fertilizationBp" INTEGER NOT NULL DEFAULT 0,
    "fertilizationUpdatedAtGameMs" BIGINT NOT NULL,
    "stateEnteredAtGameMs" BIGINT NOT NULL,
    "seededAtGameMs" BIGINT,
    "currentTaskId" UUID,
    "createdAtGameMs" BIGINT NOT NULL,
    "disposedGameMs" BIGINT,

    CONSTRAINT "fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machines" (
    "id" UUID NOT NULL,
    "playerId" UUID NOT NULL,
    "farmId" UUID NOT NULL,
    "garageId" UUID,
    "type" "MachineType" NOT NULL,
    "conditionBp" INTEGER NOT NULL DEFAULT 10000,
    "conditionUpdatedAtGameMs" BIGINT NOT NULL,
    "status" "MachineStatus" NOT NULL DEFAULT 'IDLE',
    "currentTaskId" UUID,
    "repairEndsAtGameMs" BIGINT,
    "purchasePrice" DECIMAL(20,4) NOT NULL,
    "acquiredGameMs" BIGINT NOT NULL,
    "disposedGameMs" BIGINT,

    CONSTRAINT "machines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workers" (
    "id" UUID NOT NULL,
    "playerId" UUID NOT NULL,
    "farmId" UUID NOT NULL,
    "homeId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "skillBp" INTEGER NOT NULL,
    "salaryPerGameHour" DECIMAL(20,4) NOT NULL,
    "status" "WorkerStatus" NOT NULL DEFAULT 'IDLE',
    "currentTaskId" UUID,
    "completedTaskCount" INTEGER NOT NULL DEFAULT 0,
    "hiredGameMs" BIGINT NOT NULL,
    "terminatedGameMs" BIGINT,

    CONSTRAINT "workers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worker_candidates" (
    "id" UUID NOT NULL,
    "playerId" UUID NOT NULL,
    "region" TEXT,
    "name" TEXT NOT NULL,
    "skillBp" INTEGER NOT NULL,
    "askingSalaryPerGameHour" DECIMAL(20,4) NOT NULL,
    "listedAtGameMs" BIGINT NOT NULL,
    "removedGameMs" BIGINT,

    CONSTRAINT "worker_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "playerId" UUID NOT NULL,
    "workerId" UUID NOT NULL,
    "operation" "TaskOperation" NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "targetFieldId" UUID,
    "targetForestPlotId" UUID,
    "destinationFarmId" UUID,
    "cropId" "CropId",
    "unitsAtStart" INTEGER NOT NULL,
    "effectiveWorkSpeedMilli" INTEGER NOT NULL,
    "reservedStorageUnits" INTEGER,
    "startGameMs" BIGINT NOT NULL,
    "scheduledEndGameMs" BIGINT NOT NULL,
    "endedGameMs" BIGINT,
    "cancelable" BOOLEAN NOT NULL DEFAULT true,
    "jobId" TEXT,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_machines" (
    "taskId" UUID NOT NULL,
    "machineId" UUID NOT NULL,
    "role" "MachineRole" NOT NULL,

    CONSTRAINT "task_machines_pkey" PRIMARY KEY ("taskId","machineId")
);

-- CreateTable
CREATE TABLE "forest_plots" (
    "id" UUID NOT NULL,
    "playerId" UUID NOT NULL,
    "farmId" UUID,
    "name" TEXT NOT NULL,
    "cellCount" INTEGER NOT NULL,
    "currentTaskId" UUID,
    "createdAtGameMs" BIGINT NOT NULL,
    "disposedGameMs" BIGINT,

    CONSTRAINT "forest_plots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trees" (
    "id" UUID NOT NULL,
    "forestPlotId" UUID NOT NULL,
    "playerId" UUID NOT NULL,
    "worldId" UUID NOT NULL,
    "cellX" INTEGER NOT NULL,
    "cellY" INTEGER NOT NULL,
    "species" "TreeSpecies" NOT NULL DEFAULT 'PINE',
    "plantedAtGameMs" BIGINT NOT NULL,
    "status" "TreeStatus" NOT NULL DEFAULT 'STANDING',
    "felledAtGameMs" BIGINT,
    "naturallyGenerated" BOOLEAN NOT NULL,

    CONSTRAINT "trees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL,
    "playerId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" "LedgerType" NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,
    "balanceAfter" DECIMAL(20,4) NOT NULL,
    "atGameMs" BIGINT NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "meta" JSONB,
    "idempotencyKey" TEXT NOT NULL,
    "createdAtRealMs" BIGINT NOT NULL,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_events" (
    "id" UUID NOT NULL,
    "playerId" UUID NOT NULL,
    "kind" "ScheduledEventKind" NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "dueGameMs" BIGINT NOT NULL,
    "status" "ScheduledEventStatus" NOT NULL DEFAULT 'PENDING',
    "epoch" INTEGER NOT NULL,
    "dedupeKey" TEXT,
    "enqueuedAtRealMs" BIGINT,
    "processedAtGameMs" BIGINT,
    "jobId" TEXT,

    CONSTRAINT "scheduled_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_events" (
    "id" UUID NOT NULL,
    "playerId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" "GameEventType" NOT NULL,
    "atGameMs" BIGINT NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "game_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_idempotency" (
    "id" UUID NOT NULL,
    "playerId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "statusCode" INTEGER,
    "responseBody" JSONB,
    "createdAtRealMs" BIGINT NOT NULL,
    "completedAtRealMs" BIGINT,

    CONSTRAINT "request_idempotency_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "worlds_seed_key" ON "worlds"("seed");

-- CreateIndex
CREATE INDEX "world_time_segments_worldId_fromGameMs_idx" ON "world_time_segments"("worldId", "fromGameMs");

-- CreateIndex
CREATE UNIQUE INDEX "world_time_segments_worldId_seq_key" ON "world_time_segments"("worldId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "players_email_key" ON "players"("email");

-- CreateIndex
CREATE INDEX "players_worldId_idx" ON "players"("worldId");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_playerId_idx" ON "refresh_tokens"("playerId");

-- CreateIndex
CREATE INDEX "refresh_tokens_expiresAtRealMs_idx" ON "refresh_tokens"("expiresAtRealMs");

-- CreateIndex
CREATE UNIQUE INDEX "chunks_worldId_chunkX_chunkY_key" ON "chunks"("worldId", "chunkX", "chunkY");

-- CreateIndex
CREATE INDEX "world_cells_worldId_chunkX_chunkY_idx" ON "world_cells"("worldId", "chunkX", "chunkY");

-- CreateIndex
CREATE INDEX "world_cells_ownerPlayerId_idx" ON "world_cells"("ownerPlayerId");

-- CreateIndex
CREATE INDEX "world_cells_fieldId_idx" ON "world_cells"("fieldId");

-- CreateIndex
CREATE INDEX "world_cells_forestPlotId_idx" ON "world_cells"("forestPlotId");

-- CreateIndex
CREATE INDEX "world_cells_buildingId_idx" ON "world_cells"("buildingId");

-- CreateIndex
CREATE UNIQUE INDEX "world_cells_worldId_chunkX_chunkY_idx_key" ON "world_cells"("worldId", "chunkX", "chunkY", "idx");

-- CreateIndex
CREATE INDEX "farms_playerId_idx" ON "farms"("playerId");

-- CreateIndex
CREATE INDEX "buildings_farmId_idx" ON "buildings"("farmId");

-- CreateIndex
CREATE INDEX "buildings_playerId_type_idx" ON "buildings"("playerId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "fields_currentTaskId_key" ON "fields"("currentTaskId");

-- CreateIndex
CREATE INDEX "fields_playerId_idx" ON "fields"("playerId");

-- CreateIndex
CREATE INDEX "fields_farmId_idx" ON "fields"("farmId");

-- CreateIndex
CREATE INDEX "machines_playerId_type_idx" ON "machines"("playerId", "type");

-- CreateIndex
CREATE INDEX "machines_farmId_idx" ON "machines"("farmId");

-- CreateIndex
CREATE INDEX "machines_garageId_idx" ON "machines"("garageId");

-- CreateIndex
CREATE INDEX "machines_currentTaskId_idx" ON "machines"("currentTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "workers_currentTaskId_key" ON "workers"("currentTaskId");

-- CreateIndex
CREATE INDEX "workers_playerId_status_idx" ON "workers"("playerId", "status");

-- CreateIndex
CREATE INDEX "workers_farmId_idx" ON "workers"("farmId");

-- CreateIndex
CREATE INDEX "workers_homeId_idx" ON "workers"("homeId");

-- CreateIndex
CREATE INDEX "worker_candidates_playerId_idx" ON "worker_candidates"("playerId");

-- CreateIndex
CREATE INDEX "tasks_playerId_status_idx" ON "tasks"("playerId", "status");

-- CreateIndex
CREATE INDEX "tasks_status_scheduledEndGameMs_idx" ON "tasks"("status", "scheduledEndGameMs");

-- CreateIndex
CREATE INDEX "tasks_workerId_idx" ON "tasks"("workerId");

-- CreateIndex
CREATE INDEX "tasks_targetFieldId_idx" ON "tasks"("targetFieldId");

-- CreateIndex
CREATE INDEX "tasks_targetForestPlotId_idx" ON "tasks"("targetForestPlotId");

-- CreateIndex
CREATE INDEX "task_machines_machineId_idx" ON "task_machines"("machineId");

-- CreateIndex
CREATE UNIQUE INDEX "forest_plots_currentTaskId_key" ON "forest_plots"("currentTaskId");

-- CreateIndex
CREATE INDEX "forest_plots_playerId_idx" ON "forest_plots"("playerId");

-- CreateIndex
CREATE INDEX "forest_plots_farmId_idx" ON "forest_plots"("farmId");

-- CreateIndex
CREATE INDEX "trees_forestPlotId_status_idx" ON "trees"("forestPlotId", "status");

-- CreateIndex
CREATE INDEX "trees_playerId_idx" ON "trees"("playerId");

-- CreateIndex
CREATE INDEX "trees_worldId_cellX_cellY_idx" ON "trees"("worldId", "cellX", "cellY");

-- CreateIndex
CREATE INDEX "ledger_entries_playerId_atGameMs_idx" ON "ledger_entries"("playerId", "atGameMs");

-- CreateIndex
CREATE INDEX "ledger_entries_playerId_type_atGameMs_idx" ON "ledger_entries"("playerId", "type", "atGameMs");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_playerId_seq_key" ON "ledger_entries"("playerId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_playerId_idempotencyKey_key" ON "ledger_entries"("playerId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "scheduled_events_status_dueGameMs_idx" ON "scheduled_events"("status", "dueGameMs");

-- CreateIndex
CREATE INDEX "scheduled_events_playerId_status_idx" ON "scheduled_events"("playerId", "status");

-- CreateIndex
CREATE INDEX "game_events_playerId_atGameMs_idx" ON "game_events"("playerId", "atGameMs");

-- CreateIndex
CREATE UNIQUE INDEX "game_events_playerId_seq_key" ON "game_events"("playerId", "seq");

-- CreateIndex
CREATE INDEX "request_idempotency_createdAtRealMs_idx" ON "request_idempotency"("createdAtRealMs");

-- CreateIndex
CREATE UNIQUE INDEX "request_idempotency_playerId_key_key" ON "request_idempotency"("playerId", "key");

-- AddForeignKey
ALTER TABLE "world_time_segments" ADD CONSTRAINT "world_time_segments_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "worlds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "players" ADD CONSTRAINT "players_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "worlds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "worlds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "world_cells" ADD CONSTRAINT "world_cells_worldId_chunkX_chunkY_fkey" FOREIGN KEY ("worldId", "chunkX", "chunkY") REFERENCES "chunks"("worldId", "chunkX", "chunkY") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "world_cells" ADD CONSTRAINT "world_cells_ownerPlayerId_fkey" FOREIGN KEY ("ownerPlayerId") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "world_cells" ADD CONSTRAINT "world_cells_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "fields"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "world_cells" ADD CONSTRAINT "world_cells_forestPlotId_fkey" FOREIGN KEY ("forestPlotId") REFERENCES "forest_plots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "world_cells" ADD CONSTRAINT "world_cells_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farms" ADD CONSTRAINT "farms_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "farms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fields" ADD CONSTRAINT "fields_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fields" ADD CONSTRAINT "fields_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "farms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fields" ADD CONSTRAINT "fields_currentTaskId_fkey" FOREIGN KEY ("currentTaskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machines" ADD CONSTRAINT "machines_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machines" ADD CONSTRAINT "machines_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "farms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machines" ADD CONSTRAINT "machines_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machines" ADD CONSTRAINT "machines_currentTaskId_fkey" FOREIGN KEY ("currentTaskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workers" ADD CONSTRAINT "workers_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workers" ADD CONSTRAINT "workers_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "farms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workers" ADD CONSTRAINT "workers_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workers" ADD CONSTRAINT "workers_currentTaskId_fkey" FOREIGN KEY ("currentTaskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_candidates" ADD CONSTRAINT "worker_candidates_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_targetFieldId_fkey" FOREIGN KEY ("targetFieldId") REFERENCES "fields"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_targetForestPlotId_fkey" FOREIGN KEY ("targetForestPlotId") REFERENCES "forest_plots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_destinationFarmId_fkey" FOREIGN KEY ("destinationFarmId") REFERENCES "farms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_machines" ADD CONSTRAINT "task_machines_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_machines" ADD CONSTRAINT "task_machines_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forest_plots" ADD CONSTRAINT "forest_plots_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forest_plots" ADD CONSTRAINT "forest_plots_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "farms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forest_plots" ADD CONSTRAINT "forest_plots_currentTaskId_fkey" FOREIGN KEY ("currentTaskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trees" ADD CONSTRAINT "trees_forestPlotId_fkey" FOREIGN KEY ("forestPlotId") REFERENCES "forest_plots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trees" ADD CONSTRAINT "trees_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trees" ADD CONSTRAINT "trees_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "worlds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_events" ADD CONSTRAINT "scheduled_events_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_events" ADD CONSTRAINT "game_events_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_idempotency" ADD CONSTRAINT "request_idempotency_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===========================================================================
-- Hand-written extension of the initial migration (plan section 5.4)
-- ===========================================================================
--
-- Everything above this line was produced by `prisma migrate dev`. Everything
-- below is written by hand and expresses what the Prisma schema language cannot:
-- CHECK constraints, triggers, partial indexes and expression predicates.
--
-- The idea that unifies the section: when two concurrent transactions have to see
-- each other, they must be forced to write the same row. Under READ COMMITTED,
-- which infra/postgres/init.sql sets as the database default, PostgreSQL
-- serialises the writers of a row and re-evaluates its CHECK against the value
-- already committed, which turns "add up the children and compare" into a
-- guarantee of the database with no explicit locking (plan section 5.4).
--
-- These objects are invisible to Prisma: they are not representable in the schema
-- language, so `prisma migrate diff` neither reports nor drops them. That is what
-- makes the migration idempotent with respect to the datamodel and, at the same
-- time, what makes this file the only place they are declared.
--
-- Naming: constraints are `<table>_<subject>_check`, functions are prefixed with
-- `farm_world_` so that they cannot collide with an extension, and partial
-- indexes carry the predicate in their name.

-- ---------------------------------------------------------------------------
-- 1. World and clock
-- ---------------------------------------------------------------------------

-- The multiplier is rational and `rateNum = 0` is a paused world, so the
-- numerator may be zero while the denominator may not (plan section 6.1).
ALTER TABLE "worlds"
    ADD CONSTRAINT "worlds_clock_check" CHECK (
        "rateNum" >= 0
        AND "rateDen" > 0
        AND "scheduleEpoch" >= 0
        AND "chunkSize" > 0
        AND "generatorVersion" >= 1
        AND "anchorGameMs" >= 0
        AND "anchorRealMs" >= 0
    );

ALTER TABLE "world_time_segments"
    ADD CONSTRAINT "world_time_segments_interval_check" CHECK (
        "seq" >= 0
        AND "fromGameMs" >= 0
        AND "toGameMs" >= "fromGameMs"
        AND "toRealMs" >= "fromRealMs"
        AND "rateNum" >= 0
        AND "rateDen" > 0
    );

-- Changing the multiplier is a domain operation and not a configuration update:
-- it has to freeze the past under the previous rate, re-anchor and increment the
-- epoch so that jobs scheduled under the old rate are discarded instead of firing
-- early (plan section 6.1). Without this trigger, a single UPDATE of `rateNum`
-- would silently move every future instant of the world.
--
-- The anchor is required to advance strictly in real time, which also rejects two
-- retimes inside the same millisecond. The alternative, accepting an unchanged
-- anchor, would accept an update that did not re-anchor at all.
CREATE FUNCTION farm_world_guard_world_retime() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW."anchorGameMs" < OLD."anchorGameMs" THEN
        RAISE EXCEPTION
            'The game clock never rewinds: anchorGameMs cannot decrease (plan section 6.1)'
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW."rateNum" IS DISTINCT FROM OLD."rateNum"
       OR NEW."rateDen" IS DISTINCT FROM OLD."rateDen" THEN
        IF NEW."scheduleEpoch" <= OLD."scheduleEpoch"
           OR NEW."anchorRealMs" <= OLD."anchorRealMs" THEN
            RAISE EXCEPTION
                'A change of the game rate must re-anchor the clock and increment scheduleEpoch (plan section 6.1)'
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "worlds_retime_guard"
    BEFORE UPDATE ON "worlds"
    FOR EACH ROW EXECUTE FUNCTION farm_world_guard_world_retime();

-- ---------------------------------------------------------------------------
-- 2. Player
-- ---------------------------------------------------------------------------

-- No CHECK on the balance: offline accrual of holding costs legitimately takes it
-- negative, which GDD sections 118 and 119 predict for the first cycle. What is
-- checked is that the marks are game instants and that the accrual mark never
-- precedes the start of the player.
ALTER TABLE "players"
    ADD CONSTRAINT "players_marks_check" CHECK (
        "startedAtGameMs" >= 0
        AND "lastAccrualGameMs" >= "startedAtGameMs"
        AND "lastLoginGameMs" >= 0
        AND "lastSummaryGameMs" >= 0
        AND "ledgerSeq" >= 0
        AND "eventSeq" >= 0
        AND length("email") > 0
    );

ALTER TABLE "refresh_tokens"
    ADD CONSTRAINT "refresh_tokens_interval_check" CHECK (
        "expiresAtRealMs" > "issuedAtRealMs"
        AND ("revokedAtRealMs" IS NULL OR "revokedAtRealMs" >= "issuedAtRealMs")
    );

CREATE INDEX "refresh_tokens_active_idx"
    ON "refresh_tokens" ("playerId")
    WHERE "revokedAtRealMs" IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Chunks and cells
-- ---------------------------------------------------------------------------

ALTER TABLE "chunks"
    ADD CONSTRAINT "chunks_version_check" CHECK ("version" >= 0);

-- Exclusivity of use of a cell (GDD section 15), as an intra-row CHECK: a cell
-- taken by infrastructure cannot be farmed at the same time, and the pointer that
-- says which use it is must match `landUse` exactly. The upper bound of `idx` is
-- deliberately absent, because the chunk size lives on the world row and start-up
-- verifies it against the constants of shared/config (plan section 5.1).
--
-- `ELSE false` matters: a member added to the enum later must fail loudly here
-- rather than pass because a CASE without a branch returns NULL, which a CHECK
-- accepts.
ALTER TABLE "world_cells"
    ADD CONSTRAINT "world_cells_idx_check" CHECK ("idx" >= 0),
    ADD CONSTRAINT "world_cells_use_exclusivity_check" CHECK (
        CASE "landUse"
            WHEN 'NONE' THEN
                "ownerPlayerId" IS NULL
                AND "fieldId" IS NULL AND "forestPlotId" IS NULL AND "buildingId" IS NULL
            WHEN 'OWNED' THEN
                "ownerPlayerId" IS NOT NULL
                AND "fieldId" IS NULL AND "forestPlotId" IS NULL AND "buildingId" IS NULL
            WHEN 'ROAD' THEN
                "ownerPlayerId" IS NOT NULL
                AND "fieldId" IS NULL AND "forestPlotId" IS NULL AND "buildingId" IS NULL
            WHEN 'FIELD' THEN
                "ownerPlayerId" IS NOT NULL
                AND "fieldId" IS NOT NULL AND "forestPlotId" IS NULL AND "buildingId" IS NULL
            WHEN 'FOREST_PLOT' THEN
                "ownerPlayerId" IS NOT NULL
                AND "fieldId" IS NULL AND "forestPlotId" IS NOT NULL AND "buildingId" IS NULL
            WHEN 'BUILDING' THEN
                "ownerPlayerId" IS NOT NULL
                AND "fieldId" IS NULL AND "forestPlotId" IS NULL AND "buildingId" IS NOT NULL
            ELSE false
        END
    );

-- ---------------------------------------------------------------------------
-- 4. Farm: stock against capacity
-- ---------------------------------------------------------------------------

-- Safety net, not the primary defence. The primary defence is the reservation of
-- capacity when a harvest is assigned, so that an overflow is an actionable
-- rejection, plus a single bounded statement at completion that computes what is
-- accepted and wastes the rest (GDD sections 83 and 97). A constraint violated
-- inside a queue job would produce endless retries, so the application never
-- delegates a predictable business case to this constraint (plan section 5.4).
ALTER TABLE "farms"
    ADD CONSTRAINT "farms_stock_check" CHECK (
        "storedWheatLiters" >= 0
        AND "reservedWheatLiters" >= 0
        AND "capacityWheatLiters" >= 0
        AND "storedWoodDm3" >= 0
        AND "reservedWoodDm3" >= 0
        AND "capacityWoodDm3" >= 0
        AND "storedWheatLiters" + "reservedWheatLiters" <= "capacityWheatLiters"
        AND "storedWoodDm3" + "reservedWoodDm3" <= "capacityWoodDm3"
    );

-- ---------------------------------------------------------------------------
-- 5. Buildings: capacity by counter
-- ---------------------------------------------------------------------------

-- Garage capacity (GDD section 96) and worker housing (GDD section 108) are the
-- two hard restrictions of the plan that are expressed as a counter plus a CHECK
-- in the same row. Per building rather than per farm: it is stronger than the
-- aggregate of the GDD formula, and since GDD section 101 already requires
-- `homeId`, the aggregate is satisfied by construction (plan section 5.4).
--
-- A storage building is the only kind that declares `storageResource`, and it
-- must declare it: the trigger below sums capacity by resource into the farm, and
-- a storage unit with no resource would be capacity that belongs nowhere.
ALTER TABLE "buildings"
    ADD CONSTRAINT "buildings_footprint_check" CHECK (
        "widthCells" > 0 AND "heightCells" > 0 AND "purchasePrice" >= 0
    ),
    ADD CONSTRAINT "buildings_capacity_check" CHECK (
        "capacityMachines" >= 0
        AND "capacityWorkers" >= 0
        AND "capacityStorageUnits" >= 0
        AND "machineCount" >= 0
        AND "workerCount" >= 0
        AND "machineCount" <= "capacityMachines"
        AND "workerCount" <= "capacityWorkers"
        AND ("capacityStorageUnits" > 0) = ("storageResource" IS NOT NULL)
    );

-- Occupancy of a garage. Only a machine that exists and has not been disposed of
-- occupies a slot, so the counter has to react to three things: the row appearing,
-- the row moving between garages, and the row being logically deleted.
--
-- When both an old and a new garage are involved, the two rows are updated in
-- ascending identifier order, which is the canonical lock order of the plan
-- (section 6.3) and removes the deadlock between two transactions that swap
-- machines between the same two garages.
CREATE FUNCTION farm_world_sync_garage_occupancy() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    old_garage UUID := NULL;
    new_garage UUID := NULL;
BEGIN
    IF TG_OP <> 'INSERT' AND OLD."disposedGameMs" IS NULL THEN
        old_garage := OLD."garageId";
    END IF;
    IF TG_OP <> 'DELETE' AND NEW."disposedGameMs" IS NULL THEN
        new_garage := NEW."garageId";
    END IF;

    IF old_garage IS NOT DISTINCT FROM new_garage THEN
        RETURN NULL;
    END IF;

    IF old_garage IS NOT NULL AND new_garage IS NOT NULL AND new_garage < old_garage THEN
        UPDATE "buildings" SET "machineCount" = "machineCount" + 1 WHERE "id" = new_garage;
        UPDATE "buildings" SET "machineCount" = "machineCount" - 1 WHERE "id" = old_garage;
    ELSE
        IF old_garage IS NOT NULL THEN
            UPDATE "buildings" SET "machineCount" = "machineCount" - 1 WHERE "id" = old_garage;
        END IF;
        IF new_garage IS NOT NULL THEN
            UPDATE "buildings" SET "machineCount" = "machineCount" + 1 WHERE "id" = new_garage;
        END IF;
    END IF;

    RETURN NULL;
END;
$$;

CREATE TRIGGER "machines_garage_occupancy"
    AFTER INSERT OR DELETE OR UPDATE OF "garageId", "disposedGameMs" ON "machines"
    FOR EACH ROW EXECUTE FUNCTION farm_world_sync_garage_occupancy();

-- Occupancy of a worker home, with the same shape. A terminated worker frees the
-- slot, which is what GDD section 109 describes as "Home slot liberado".
CREATE FUNCTION farm_world_sync_home_occupancy() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    old_home UUID := NULL;
    new_home UUID := NULL;
BEGIN
    IF TG_OP <> 'INSERT' AND OLD."terminatedGameMs" IS NULL THEN
        old_home := OLD."homeId";
    END IF;
    IF TG_OP <> 'DELETE' AND NEW."terminatedGameMs" IS NULL THEN
        new_home := NEW."homeId";
    END IF;

    IF old_home IS NOT DISTINCT FROM new_home THEN
        RETURN NULL;
    END IF;

    IF old_home IS NOT NULL AND new_home IS NOT NULL AND new_home < old_home THEN
        UPDATE "buildings" SET "workerCount" = "workerCount" + 1 WHERE "id" = new_home;
        UPDATE "buildings" SET "workerCount" = "workerCount" - 1 WHERE "id" = old_home;
    ELSE
        IF old_home IS NOT NULL THEN
            UPDATE "buildings" SET "workerCount" = "workerCount" - 1 WHERE "id" = old_home;
        END IF;
        IF new_home IS NOT NULL THEN
            UPDATE "buildings" SET "workerCount" = "workerCount" + 1 WHERE "id" = new_home;
        END IF;
    END IF;

    RETURN NULL;
END;
$$;

CREATE TRIGGER "workers_home_occupancy"
    AFTER INSERT OR DELETE OR UPDATE OF "homeId", "terminatedGameMs" ON "workers"
    FOR EACH ROW EXECUTE FUNCTION farm_world_sync_home_occupancy();

-- Storage capacity of a farm is the sum of the capacities of its live storage
-- buildings. It is recomputed rather than incremented: the operation is rare, the
-- statement is one aggregate per affected farm, and a recomputation cannot drift.
-- Together with `farms_stock_check` it means demolishing a silo that still holds
-- grain fails, which is the behaviour the interface reports as BUILDING_NOT_EMPTY.
CREATE FUNCTION farm_world_sync_farm_storage_capacity() RETURNS TRIGGER
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

    -- Ascending identifier order, which is the canonical lock order of the plan
    -- (section 6.3): a building that moves between two farms touches two rows.
    SELECT array_agg(f ORDER BY f) INTO affected FROM unnest(affected) AS f;

    FOREACH farm IN ARRAY affected
    LOOP
        UPDATE "farms"
           SET "capacityWheatLiters" = COALESCE((
                   SELECT SUM(b."capacityStorageUnits")
                     FROM "buildings" b
                    WHERE b."farmId" = farm
                      AND b."disposedGameMs" IS NULL
                      AND b."storageResource" = 'WHEAT_LITERS'
               ), 0)::INTEGER,
               "capacityWoodDm3" = COALESCE((
                   SELECT SUM(b."capacityStorageUnits")
                     FROM "buildings" b
                    WHERE b."farmId" = farm
                      AND b."disposedGameMs" IS NULL
                      AND b."storageResource" = 'WOOD_M3'
               ), 0)::INTEGER
         WHERE "id" = farm;
    END LOOP;

    RETURN NULL;
END;
$$;

CREATE TRIGGER "buildings_farm_storage_capacity"
    AFTER INSERT OR DELETE OR
    UPDATE OF "farmId", "capacityStorageUnits", "storageResource", "disposedGameMs" ON "buildings"
    FOR EACH ROW EXECUTE FUNCTION farm_world_sync_farm_storage_capacity();

-- ---------------------------------------------------------------------------
-- 6. Fields
-- ---------------------------------------------------------------------------

ALTER TABLE "fields"
    ADD CONSTRAINT "fields_geometry_check" CHECK ("cellCount" > 0),
    ADD CONSTRAINT "fields_basis_points_check" CHECK (
        "fertilityBp" BETWEEN 0 AND 10000
        AND "weedLevelBp" BETWEEN 0 AND 10000
        AND "fertilizationBp" BETWEEN 0 AND 10000
    ),
    ADD CONSTRAINT "fields_marks_check" CHECK (
        "createdAtGameMs" >= 0
        AND "stateEnteredAtGameMs" >= 0
        AND "fertilityUpdatedAtGameMs" >= 0
        AND "weedLevelUpdatedAtGameMs" >= 0
        AND "fertilizationUpdatedAtGameMs" >= 0
        AND ("seededAtGameMs" IS NULL OR "seededAtGameMs" >= 0)
        AND ("disposedGameMs" IS NULL OR "disposedGameMs" >= "createdAtGameMs")
    ),
    -- A field inside the sown part of the cycle has a crop and a growth timeline:
    -- the phase and the growth progress are projected from `seededAtGameMs` and the
    -- crop, so neither may be missing (GDD sections 76, 80 and 85).
    ADD CONSTRAINT "fields_growth_timeline_check" CHECK (
        "cropCycleState" NOT IN ('SEEDED', 'GERMINATING', 'GROWING', 'READY_TO_HARVEST')
        OR ("cropId" IS NOT NULL AND "seededAtGameMs" IS NOT NULL)
    );

-- ---------------------------------------------------------------------------
-- 7. Machinery
-- ---------------------------------------------------------------------------

ALTER TABLE "machines"
    ADD CONSTRAINT "machines_condition_check" CHECK ("conditionBp" BETWEEN 0 AND 10000),
    ADD CONSTRAINT "machines_price_check" CHECK ("purchasePrice" >= 0),
    ADD CONSTRAINT "machines_life_check" CHECK (
        "acquiredGameMs" >= 0
        AND "conditionUpdatedAtGameMs" >= 0
        AND ("disposedGameMs" IS NULL OR "disposedGameMs" >= "acquiredGameMs")
        -- A machine that has been sold cannot still be reserved by a task, which
        -- is what keeps the operating cost integral of plan section 6.2 finite.
        AND ("disposedGameMs" IS NULL OR "currentTaskId" IS NULL)
    ),
    ADD CONSTRAINT "machines_repair_check" CHECK (
        "repairEndsAtGameMs" IS NULL OR "status" = 'IN_REPAIR'
    );

-- A machine cannot change farm while it is reserved by a task: the farm of the
-- machine is what the trigger of GDD section 108 compares against the farm of the
-- worker, and allowing the move would let a worker finish a task on machinery
-- that is no longer his farm's.
CREATE FUNCTION farm_world_guard_machine_farm_move() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW."farmId" IS DISTINCT FROM OLD."farmId" AND OLD."currentTaskId" IS NOT NULL THEN
        RAISE EXCEPTION
            'A machine reserved by a task cannot change farm (GDD section 108)'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "machines_farm_move_guard"
    BEFORE UPDATE OF "farmId" ON "machines"
    FOR EACH ROW EXECUTE FUNCTION farm_world_guard_machine_farm_move();

-- Idle machinery of a type, which is the query the assignment panel and the
-- validation of GDD section 104 run on every task. Partial, because a machine that
-- is working, being repaired or sold is never a candidate.
CREATE INDEX "machines_idle_by_type_idx"
    ON "machines" ("playerId", "type")
    WHERE "status" = 'IDLE' AND "currentTaskId" IS NULL AND "disposedGameMs" IS NULL;

-- ---------------------------------------------------------------------------
-- 8. Workers
-- ---------------------------------------------------------------------------

ALTER TABLE "workers"
    ADD CONSTRAINT "workers_skill_check" CHECK ("skillBp" BETWEEN 0 AND 10000),
    ADD CONSTRAINT "workers_salary_check" CHECK ("salaryPerGameHour" >= 0),
    ADD CONSTRAINT "workers_life_check" CHECK (
        "hiredGameMs" >= 0
        AND "completedTaskCount" >= 0
        AND ("terminatedGameMs" IS NULL OR "terminatedGameMs" >= "hiredGameMs")
        -- GDD section 109: a worker cannot be dismissed in the middle of a task.
        AND ("terminatedGameMs" IS NULL OR "currentTaskId" IS NULL)
    );

ALTER TABLE "worker_candidates"
    ADD CONSTRAINT "worker_candidates_check" CHECK (
        "skillBp" BETWEEN 0 AND 10000
        AND "askingSalaryPerGameHour" >= 0
        AND "listedAtGameMs" >= 0
        AND ("removedGameMs" IS NULL OR "removedGameMs" >= "listedAtGameMs")
    );

-- GDD section 109 rejects dismissal in the middle of a task. The CHECK above
-- already forbids it through the reservation column, but that defence holds only
-- while the application keeps `currentTaskId` in step, and dismissal is precisely
-- the path that is tempted to clear it first. This trigger reads the tasks
-- instead, so the rule does not depend on another column being right. It costs one
-- indexed lookup, and only when a worker is actually dismissed.
CREATE FUNCTION farm_world_guard_worker_termination() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW."terminatedGameMs" IS NOT NULL AND OLD."terminatedGameMs" IS NULL
       AND EXISTS (
           SELECT 1 FROM "tasks" t
            WHERE t."workerId" = NEW."id" AND t."status" = 'IN_PROGRESS'
       ) THEN
        RAISE EXCEPTION
            'A worker with a task in progress cannot be dismissed (GDD section 109)'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "workers_termination_guard"
    BEFORE UPDATE OF "terminatedGameMs" ON "workers"
    FOR EACH ROW EXECUTE FUNCTION farm_world_guard_worker_termination();

CREATE INDEX "workers_idle_idx"
    ON "workers" ("playerId")
    WHERE "status" = 'IDLE' AND "currentTaskId" IS NULL AND "terminatedGameMs" IS NULL;

CREATE INDEX "worker_candidates_available_idx"
    ON "worker_candidates" ("playerId")
    WHERE "removedGameMs" IS NULL;

-- ---------------------------------------------------------------------------
-- 9. Tasks
-- ---------------------------------------------------------------------------

ALTER TABLE "tasks"
    ADD CONSTRAINT "tasks_units_check" CHECK (
        "unitsAtStart" > 0
        AND "effectiveWorkSpeedMilli" > 0
        AND ("reservedStorageUnits" IS NULL OR "reservedStorageUnits" >= 0)
    ),
    ADD CONSTRAINT "tasks_interval_check" CHECK (
        "startGameMs" >= 0
        AND "scheduledEndGameMs" >= "startGameMs"
        AND ("endedGameMs" IS NULL OR "endedGameMs" >= "startGameMs")
    ),
    -- A finished task has a real end and an unfinished one does not. This is what
    -- makes the operating cost integral of plan section 6.2 read
    -- `coalesce(endedGameMs, scheduledEndGameMs)` without special cases.
    ADD CONSTRAINT "tasks_end_state_check" CHECK (
        ("status" = 'IN_PROGRESS') = ("endedGameMs" IS NULL)
    ),
    -- At most one target. `CLEAR_LAND` has none, because it targets a set of cells
    -- (GDD section 10); a task with both would be ambiguous.
    ADD CONSTRAINT "tasks_target_check" CHECK (
        NOT ("targetFieldId" IS NOT NULL AND "targetForestPlotId" IS NOT NULL)
    );

CREATE INDEX "tasks_in_progress_due_idx"
    ON "tasks" ("scheduledEndGameMs")
    WHERE "status" = 'IN_PROGRESS';

-- A worker of one farm cannot operate machinery of another (GDD section 108). The
-- rule lives here and not only in the application because the task is the single
-- authoritative link between worker and machine (plan section 5.2): if it can be
-- written wrong, the whole cost attribution of a farm can be written wrong.
CREATE FUNCTION farm_world_guard_task_machine_farm() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    task_player  UUID;
    worker_farm  UUID;
    machine_player UUID;
    machine_farm UUID;
BEGIN
    SELECT t."playerId", w."farmId"
      INTO task_player, worker_farm
      FROM "tasks" t
      JOIN "workers" w ON w."id" = t."workerId"
     WHERE t."id" = NEW."taskId";

    SELECT m."playerId", m."farmId"
      INTO machine_player, machine_farm
      FROM "machines" m
     WHERE m."id" = NEW."machineId";

    IF task_player IS NULL OR machine_farm IS NULL THEN
        RAISE EXCEPTION
            'task_machines requires an existing task with its worker and an existing machine'
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF machine_player <> task_player THEN
        RAISE EXCEPTION
            'A task may only use machinery of its own player'
            USING ERRCODE = 'check_violation';
    END IF;

    IF machine_farm <> worker_farm THEN
        RAISE EXCEPTION
            'A worker of farm % cannot operate machinery of farm % (GDD section 108)',
            worker_farm, machine_farm
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "task_machines_farm_guard"
    BEFORE INSERT OR UPDATE ON "task_machines"
    FOR EACH ROW EXECUTE FUNCTION farm_world_guard_task_machine_farm();

-- ---------------------------------------------------------------------------
-- 10. Forestry
-- ---------------------------------------------------------------------------

ALTER TABLE "forest_plots"
    ADD CONSTRAINT "forest_plots_geometry_check" CHECK (
        "cellCount" > 0
        AND "createdAtGameMs" >= 0
        AND ("disposedGameMs" IS NULL OR "disposedGameMs" >= "createdAtGameMs")
    );

-- Felling is a logical deletion: the row stays with its status and its instant, so
-- the wood produced by a past batch remains auditable (plan section 2.2,
-- resolution of GDD section 132).
ALTER TABLE "trees"
    ADD CONSTRAINT "trees_life_check" CHECK (
        "plantedAtGameMs" >= 0
        AND ("felledAtGameMs" IS NULL OR "felledAtGameMs" >= "plantedAtGameMs")
        AND ("status" = 'FELLED') = ("felledAtGameMs" IS NOT NULL)
    );

-- One tree per cell (GDD section 130), over the standing trees only: the same cell
-- may legitimately carry a new tree after the previous one was felled and
-- replanted, and the felled row never disappears. A plain unique constraint would
-- therefore make replanting impossible, which is why this index is partial and
-- cannot be expressed in the Prisma schema.
CREATE UNIQUE INDEX "trees_standing_cell_key"
    ON "trees" ("worldId", "cellX", "cellY")
    WHERE "felledAtGameMs" IS NULL;

-- ---------------------------------------------------------------------------
-- 11. Ledger
-- ---------------------------------------------------------------------------

-- No CHECK forbidding a zero amount: `HARVEST_WASTE` carries no money and exists
-- only so the return summary can explain the grain that did not fit in the silo
-- (GDD sections 83 and 97), with the wasted volume travelling in `meta`.
ALTER TABLE "ledger_entries"
    ADD CONSTRAINT "ledger_entries_check" CHECK (
        "seq" > 0
        AND "atGameMs" >= 0
        AND length("idempotencyKey") > 0
    );

-- ---------------------------------------------------------------------------
-- 12. Simulation
-- ---------------------------------------------------------------------------

ALTER TABLE "scheduled_events"
    ADD CONSTRAINT "scheduled_events_check" CHECK (
        "dueGameMs" >= 0
        AND "epoch" >= 0
        AND ("status" <> 'PENDING' OR "processedAtGameMs" IS NULL)
        AND ("status" <> 'PROCESSED' OR "processedAtGameMs" IS NOT NULL)
    );

-- The sweep of plan section 6.4 reads exactly this: what is pending and already
-- due, in order. Partial, because a processed row is never read again and the
-- outbox is expected to be dominated by them.
CREATE INDEX "scheduled_events_pending_due_idx"
    ON "scheduled_events" ("dueGameMs")
    WHERE "status" = 'PENDING';

-- What is pending and has no alarm clock in Redis yet, which is what the
-- scheduling horizon of plan section 6.4 walks when it moves forward, and also
-- what a paused world parks.
CREATE INDEX "scheduled_events_pending_unqueued_idx"
    ON "scheduled_events" ("dueGameMs")
    WHERE "status" = 'PENDING' AND "enqueuedAtRealMs" IS NULL;

-- Scheduling the same fact twice is a no-op while it is pending, and legitimate
-- once it has been processed: the pool refresh of GDD section 102 reschedules the
-- same key on every cycle. A total unique constraint would forbid the second
-- occurrence, so the uniqueness is partial.
CREATE UNIQUE INDEX "scheduled_events_pending_dedupe_key"
    ON "scheduled_events" ("playerId", "dedupeKey")
    WHERE "status" = 'PENDING' AND "dedupeKey" IS NOT NULL;

-- `CLOCK` is transport only: it is periodic, carries no domain change and consumes
-- no sequence number, so it must never reach the log that backs the
-- resynchronisation ring (plan section 7).
ALTER TABLE "game_events"
    ADD CONSTRAINT "game_events_check" CHECK (
        "seq" > 0
        AND "atGameMs" >= 0
        AND "type" <> 'CLOCK'
    );

ALTER TABLE "request_idempotency"
    ADD CONSTRAINT "request_idempotency_check" CHECK (
        length("key") > 0
        AND length("requestHash") > 0
        AND ("statusCode" IS NULL OR "statusCode" BETWEEN 100 AND 599)
        AND ("completedAtRealMs" IS NULL OR "completedAtRealMs" >= "createdAtRealMs")
        AND ("statusCode" IS NULL) = ("completedAtRealMs" IS NULL)
    );

-- ---------------------------------------------------------------------------
-- 13. Append-only records
-- ---------------------------------------------------------------------------

-- Three records are written once and never rewritten: the ledger, whose
-- immutability is what makes it auditable (plan section 5.3); the per player event
-- log, whose sequence the client trusts to detect gaps (plan section 7); and the
-- record of world time segments, which is the frozen past of the clock (plan
-- section 6.1).
--
-- Only UPDATE is rejected, not DELETE. Rewriting a written record is a corruption
-- of history and has no legitimate caller; removing rows does: deleting a player
-- cascades into them, `prisma migrate reset` drops the schema, and integration
-- fixtures tear themselves down. A correction is always a new entry, never an
-- edit.
CREATE FUNCTION farm_world_reject_update() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION
        'Table % is append-only: a written row is never updated (plan sections 5.3, 6.1 and 7)',
        TG_TABLE_NAME
        USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER "ledger_entries_append_only"
    BEFORE UPDATE ON "ledger_entries"
    FOR EACH ROW EXECUTE FUNCTION farm_world_reject_update();

CREATE TRIGGER "game_events_append_only"
    BEFORE UPDATE ON "game_events"
    FOR EACH ROW EXECUTE FUNCTION farm_world_reject_update();

CREATE TRIGGER "world_time_segments_append_only"
    BEFORE UPDATE ON "world_time_segments"
    FOR EACH ROW EXECUTE FUNCTION farm_world_reject_update();
