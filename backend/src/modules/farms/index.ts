// The four routes of the `farms` area.
//
// Owner: workflow W4-B. Module `farms`. It replaces the scaffolding W3-A left here, without
// touching `src/app.ts` or the route registry (plan section 11, rule 3).
//
//   GET    /api/farms                     the farms of the player, their buildings and the
//                                         capacities each one grants.
//   POST   /api/farms                     creates a farm. No land, no money.
//   POST   /api/farms/:farmId/buildings    raises a building on a footprint, buying the cells
//                                         of that footprint when the request asks for it.
//   DELETE /api/buildings/:buildingId      retires an empty building and refunds the resale
//                                         value, returning the cells to owned land.
//
// The three mutating routes are `sequenced` in the contract, so all three run inside
// `withPlayerAdvanced`: it is what advances the player in the same transaction as the writes,
// what makes every affordability check compare against a settled balance, and the only thing
// that returns the `seq` a sequenced reply has to carry (ADR-0017).
//
// WHY A FARM COSTS NOTHING AND A BUILDING COSTS EVERYTHING. GDD section 23 makes the farm a
// physical entity, and it is: what occupies cells are its buildings (GDD sections 25 to 29),
// and the `Farm` row carries no geometry at all. So creating a farm is bookkeeping — it is
// the unit that owns the fungible stock and that a field, a machine or a worker belongs to —
// and every physical and economic consequence lands on `POST /api/farms/:farmId/buildings`.
//
// THE ORDER INSIDE THE BUILDING TRANSACTION is fixed and each step depends on the one before:
//
//   1. The farm, which must exist and belong to the player.
//   2. The footprint from the catalogue, and the state of its cells from `world/service.ts`.
//   3. The verdict of the shared rules and the price, in `placement.ts`.
//   4. The quote the client showed, when it sent one, so a stale price is refused rather
//      than silently charged.
//   5. Affordability against the settled balance, read under the player lock.
//   6. The land, bought with the conditional claim that charges for what was acquired and
//      not for what was asked (ADR-0018).
//   7. The building row, then the use of the cells, which is the write that makes the
//      exclusivity of GDD section 15 true.
//   8. The two ledger entries, the chunk patches and the frames.
//
// Steps 6 and 7 are what makes this different from a menu: the cells stop being available
// for a field the moment the building stands on them, and the renderer learns it through the
// same `CHUNK_PATCHED` frame a land purchase produces.

import { type FastifyInstance } from 'fastify';
import { withPlayerAdvanced } from '../../lib/advancePlayer.js';
import { fromMoney, toMoney } from '../../lib/dbMap.js';
import { requestKey } from '../../lib/ids.js';
import { charge, credit } from '../../lib/ledger.js';
import { buildPlayerDto, toLedgerEntryDto } from '../../lib/playerView.js';
import { requirePlayer } from '../../plugins/auth.js';
import { defineRoute } from '../../plugins/routes.js';
import {
  ApiError,
  BUILDING_CATALOGUE,
  LandUse,
  LedgerType,
  Money,
  ValidationCode,
  fromWireMoney,
  buildingResaleValue,
  insufficientFunds,
  notFound,
  notOwned,
  spendingBlockedInDebt,
  toWireGameMs,
  toWireMoney,
  type BuildingId,
  type CellCoord,
  type FarmId,
  type LedgerEntry,
  type RouteReply,
} from '../../shared/index.js';
import {
  assignCellUse,
  chunkPatchesFor,
  chunksOfCells,
  claimCells,
  loadSelectionCells,
} from '../world/service.js';
import { withConstraintTranslation } from './constraints.js';
import { footprintCells, planPlacement } from './placement.js';
import { buildFarmDto, buildFarmsReply, toBuildingDto } from './readModel.js';
import { loadFarmStorage, requireFarm, storageUsageOf, type BuildingRow } from './service.js';

/** Columns of a building row, kept next to the writer that has to fill every one of them. */
const BUILDING_SELECT = {
  id: true,
  farmId: true,
  type: true,
  originCellX: true,
  originCellY: true,
  widthCells: true,
  heightCells: true,
  capacityMachines: true,
  capacityWorkers: true,
  capacityStorageUnits: true,
  storageResource: true,
  machineCount: true,
  workerCount: true,
  builtAtGameMs: true,
} as const;

/**
 * The capacity columns a building of a type is created with.
 *
 * Read from `capacityKind` of the shared catalogue rather than from a switch on the type, so
 * that adding a building to `shared/config/buildings.ts` needs no change here. The three
 * columns are separate because a single one could not tell the `CHECK` what it is counting
 * (backend/prisma/schema.prisma, `Building`), and `capacityStorageUnits > 0` must agree with
 * `storageResource IS NOT NULL`, which the same catalogue entry guarantees.
 */
function capacityColumnsOf(type: keyof typeof BUILDING_CATALOGUE): {
  capacityMachines: number;
  capacityWorkers: number;
  capacityStorageUnits: number;
  storageResource: BuildingRow['storageResource'];
} {
  const definition = BUILDING_CATALOGUE[type];
  const capacity = definition.capacity ?? 0;
  return {
    capacityMachines: definition.capacityKind === 'MACHINES' ? capacity : 0,
    capacityWorkers: definition.capacityKind === 'WORKERS' ? capacity : 0,
    capacityStorageUnits: definition.capacityKind === 'STORAGE' ? capacity : 0,
    storageResource: definition.capacityKind === 'STORAGE' ? definition.capacityResource : null,
  };
}

/** Registra las rutas del area `farms`. Invocada una vez por `src/app.ts`. */
export function registerFarmsRoutes(app: FastifyInstance): void {
  // -------------------------------------------------------------------------
  // GET /api/farms
  // -------------------------------------------------------------------------
  defineRoute(app, 'GET /api/farms', async (request) => {
    const auth = requirePlayer(request);
    const body: RouteReply<'GET /api/farms'> = await buildFarmsReply(
      request.server.services.prisma,
      auth.playerId,
    );
    return body;
  });

  // -------------------------------------------------------------------------
  // POST /api/farms
  // -------------------------------------------------------------------------
  //
  // A farm occupies nothing and costs nothing (GDD sections 23 and 24, and the `Farm` model,
  // which carries no geometry), so the route moves no money and needs no idempotency key.
  // What it does produce is a sequence number, because the client keeps a normalised store of
  // farms and a creation it did not see would leave a field or a machine pointing at nothing.
  defineRoute(app, 'POST /api/farms', async (request) => {
    const auth = requirePlayer(request);
    const services = request.server.services;

    const outcome = await withPlayerAdvanced(services, auth.playerId, async (context) => {
      const created = await context.tx.farm.create({
        data: {
          playerId: auth.playerId,
          name: request.body.name,
          createdAtGameMs: context.reading.gameNow,
        },
        select: { id: true },
      });
      const farm = await buildFarmDto(context.tx, created.id);
      context.emit({ type: 'FARM_UPSERTED', payload: { farm } });
      return { farm };
    });

    const reply: RouteReply<'POST /api/farms'> = {
      seq: outcome.seq,
      atGameMs: toWireGameMs(outcome.atGameMs),
      result: outcome.result,
    };
    return reply;
  });

  // -------------------------------------------------------------------------
  // POST /api/farms/:farmId/buildings
  // -------------------------------------------------------------------------
  defineRoute(app, 'POST /api/farms/:farmId/buildings', async (request) => {
    const auth = requirePlayer(request);
    const services = request.server.services;
    const body = request.body;
    // The header is mandatory on this route, so the guard has already stored a record; the
    // fallback keeps the ledger keys deterministic for a caller that reached the handler
    // some other way, such as a test that drives the module directly.
    const clientKey =
      request.idempotency?.key ??
      `${request.params.farmId}:${body.type}:${body.originCellX}:${body.originCellY}`;

    const outcome = await withPlayerAdvanced(services, auth.playerId, async (context) => {
      const { tx, reading, lock } = context;
      const world = reading.world;

      // 1. The farm.
      const farm = await requireFarm(tx, auth.playerId, request.params.farmId);

      // 2. The footprint and what its cells currently are.
      const cells = footprintCells(body.type, body.originCellX, body.originCellY);
      const loaded = await loadSelectionCells(services, tx, world, auth.playerId, cells);

      // 3. The shared rules decide, and price the result.
      const plan = planPlacement(
        {
          type: body.type,
          originCellX: body.originCellX,
          originCellY: body.originCellY,
          purchaseFootprintLand: body.purchaseFootprintLand,
        },
        loaded,
      );

      // 4. The quote the client showed the player. A mismatch is a stale price, not a rule
      //    of the game, so it is a 400 naming the field rather than a conflict.
      if (
        body.expectedTotal !== undefined &&
        Money.compare(fromWireMoney(body.expectedTotal), plan.totalPaid) !== 0
      ) {
        throw new ApiError(ValidationCode.VALIDATION_FAILED, {
          field: 'body.expectedTotal',
          expected: toWireMoney(plan.totalPaid),
          actual: body.expectedTotal,
        });
      }

      // 5. Affordability, against the settled balance and inside this transaction. The player
      //    row is locked by `withPlayerAdvanced`, so the reading cannot be overtaken; the
      //    conditional update inside `charge` remains the second, independent defence.
      const settled = toMoney(
        (
          await tx.player.findUniqueOrThrow({
            where: { id: auth.playerId },
            select: { balance: true },
          })
        ).balance,
      );
      if (Money.isNegative(settled)) {
        // Raising a building is discretionary spending, which a negative settled balance
        // blocks (plan section 6.6). Selling and assigning tasks stay available, because
        // they are the only way out.
        throw spendingBlockedInDebt(toWireMoney(settled));
      }
      if (Money.compare(settled, plan.totalPaid) < 0) {
        throw insufficientFunds(toWireMoney(plan.totalPaid), toWireMoney(settled));
      }

      // 6. The land, when the request asked to buy it (GDD section 115).
      let acquired: readonly CellCoord[] = [];
      if (plan.cellsToBuy.length > 0) {
        const claim = await claimCells(
          services,
          tx,
          world,
          auth.playerId,
          plan.cellsToBuy,
          reading.atRealMs,
        );
        if (claim.refused.length > 0) {
          // Somebody bought one of these cells between the validation and here. Abandoning
          // the whole transaction is the only correct answer: a footprint with a hole in it
          // is not a building.
          throw new ApiError(ValidationCode.CELL_ALREADY_OWNED, {
            cells: [...claim.refused],
            cellCount: claim.refused.length,
          });
        }
        acquired = claim.acquired;
      }

      // 7. The building, then the use of its cells.
      const created = await tx.building.create({
        data: {
          farmId: farm.id,
          playerId: auth.playerId,
          type: body.type,
          originCellX: body.originCellX,
          originCellY: body.originCellY,
          widthCells: BUILDING_CATALOGUE[body.type].widthCells,
          heightCells: BUILDING_CATALOGUE[body.type].heightCells,
          // The land is a separate entry when it was bought, so what the building row records
          // is the structure alone (backend/prisma/schema.prisma, `Building.purchasePrice`).
          purchasePrice: fromMoney(plan.buildingPaid),
          ...capacityColumnsOf(body.type),
          builtAtGameMs: reading.gameNow,
        },
        select: BUILDING_SELECT,
      });

      const assigned = await withConstraintTranslation(
        () =>
          assignCellUse(services, tx, {
            world,
            playerId: auth.playerId,
            cells: plan.cells,
            landUse: LandUse.BUILDING,
            buildingId: created.id,
            atRealMs: reading.atRealMs,
          }),
        { buildingType: body.type, entityId: created.id },
      );
      if (!assigned.complete) {
        // A cell of the footprint stopped being free between the validation and the write.
        // The row count is the decision, and a partial footprint is not a domain state that
        // exists, so the transaction is abandoned (ADR-0018).
        throw new ApiError(ValidationCode.BUILDING_FOOTPRINT_OVERLAPS, {
          entityId: created.id,
          cellCount: plan.cells.length - assigned.affected,
        });
      }

      // 8. The money. Two entries and not one: GDD section 116 is the structure and GDD
      //    section 115 is the land, and the return summary of GDD section 124 aggregates by
      //    kind, so folding them together would make a building look like land.
      const entries: LedgerEntry[] = [];
      let balanceAfter = settled;
      if (!Money.isZero(plan.landPaid)) {
        const paidLand = await charge(tx, lock, {
          type: LedgerType.LAND_PURCHASE,
          amount: plan.landPaid,
          atGameMs: reading.gameNow,
          atRealMs: reading.atRealMs,
          idempotencyKey: requestKey(auth.playerId, 'building-land', clientKey),
          refType: 'BUILDING',
          refId: created.id,
          meta: { cells: acquired.length, gddSection: 115 },
        });
        if (!paidLand.ok) {
          throw insufficientFunds(toWireMoney(plan.totalPaid), toWireMoney(paidLand.available));
        }
        entries.push(paidLand.entry);
        balanceAfter = paidLand.balanceAfter;
      }
      const paidBuilding = await charge(tx, lock, {
        type: LedgerType.BUILDING_PURCHASE,
        amount: plan.buildingPaid,
        atGameMs: reading.gameNow,
        atRealMs: reading.atRealMs,
        idempotencyKey: requestKey(auth.playerId, 'building-purchase', clientKey),
        refType: 'BUILDING',
        refId: created.id,
        meta: { buildingType: body.type, gddSection: 116 },
      });
      if (!paidBuilding.ok) {
        throw insufficientFunds(toWireMoney(plan.totalPaid), toWireMoney(paidBuilding.available));
      }
      entries.push(paidBuilding.entry);
      balanceAfter = paidBuilding.balanceAfter;

      // 9. What the client has to be told.
      const patches = await chunkPatchesFor(
        services,
        tx,
        world,
        chunksOfCells(plan.cells, world.chunkSize),
      );
      const farmDto = await buildFarmDto(tx, farm.id);
      const buildingDto = toBuildingDto(created);
      const player = await buildPlayerDto(tx, auth.playerId, reading);

      context.emit(
        { type: 'BUILDING_UPSERTED', payload: { building: buildingDto } },
        { type: 'FARM_UPSERTED', payload: { farm: farmDto } },
        ...patches
          .filter((patch) => patch.cells.length > 0)
          .map((patch) => ({ type: 'CHUNK_PATCHED', payload: patch }) as const),
        { type: 'PLAYER_UPSERTED', payload: { player } },
        {
          type: 'LEDGER_APPENDED',
          payload: {
            entries: entries.map(toLedgerEntryDto),
            balance: toWireMoney(balanceAfter),
          },
        },
      );

      return {
        building: buildingDto,
        farm: farmDto,
        landPurchasedCells: acquired.length,
        buildingPaid: toWireMoney(plan.buildingPaid),
        landPaid: toWireMoney(plan.landPaid),
        totalPaid: toWireMoney(plan.totalPaid),
        balanceAfter: toWireMoney(balanceAfter),
        footprintCells: [...plan.cells],
      };
    });

    const reply: RouteReply<'POST /api/farms/:farmId/buildings'> = {
      seq: outcome.seq,
      atGameMs: toWireGameMs(outcome.atGameMs),
      result: outcome.result,
    };
    return reply;
  });

  // -------------------------------------------------------------------------
  // DELETE /api/buildings/:buildingId
  // -------------------------------------------------------------------------
  //
  // Retiring a building is a logical deletion: the row stays with `disposedGameMs`, because
  // the ledger entry that paid for it points at its identifier without a foreign key and a
  // hard delete would destroy the trail (ADR-0009). What does change is the cells, which go
  // back to owned land with no use; the land itself is not sold, which is why the reply
  // reports `releasedCells` and no land revenue.
  //
  // "Empty" is checked here and not left to the constraints, for the reason of ADR-0018: a
  // garage with a machine in it, a home with a worker in it and a store with stock in it are
  // all predictable refusals, and the interface has to be able to say which one it was.
  defineRoute(app, 'DELETE /api/buildings/:buildingId', async (request) => {
    const auth = requirePlayer(request);
    const services = request.server.services;
    const clientKey = request.idempotency?.key ?? request.params.buildingId;

    const outcome = await withPlayerAdvanced(services, auth.playerId, async (context) => {
      const { tx, reading, lock } = context;
      const world = reading.world;

      const found = await tx.building.findUnique({
        where: { id: request.params.buildingId },
        select: { ...BUILDING_SELECT, playerId: true, disposedGameMs: true },
      });
      if (found === null || found.disposedGameMs !== null) {
        throw notFound('Building', request.params.buildingId);
      }
      if (found.playerId !== auth.playerId) {
        throw notOwned('Building', request.params.buildingId);
      }

      // Counted capacity: a machine or a worker still lives here (GDD sections 96 and 108).
      if (found.machineCount > 0 || found.workerCount > 0) {
        throw new ApiError(ValidationCode.BUILDING_NOT_EMPTY, {
          entityId: found.id,
          entityKind: found.type,
          occupancy: found.machineCount + found.workerCount,
          capacity: found.capacityMachines + found.capacityWorkers,
        });
      }

      const farm = await requireFarm(tx, auth.playerId, found.farmId);

      // Storage: removing the capacity must not leave the farm holding more than it can.
      // Checked against stock plus reservation, because a harvest already assigned has
      // committed room it is going to use (plan section 5.4).
      if (found.capacityStorageUnits > 0 && found.storageResource !== null) {
        const storage = await loadFarmStorage(tx, [farm.id]);
        const usage = storageUsageOf(storage, found.storageResource);
        const remaining = usage.capacityUnits - found.capacityStorageUnits;
        if (usage.storedUnits + usage.reservedUnits > remaining) {
          throw new ApiError(ValidationCode.BUILDING_NOT_EMPTY, {
            entityId: found.id,
            entityKind: found.type,
            occupancy: usage.storedUnits + usage.reservedUnits,
            capacity: remaining < 0 ? 0 : remaining,
          });
        }
      }

      // The cells go back to owned land, with the same conditional update the placement used.
      const cellRows = await tx.worldCell.findMany({
        where: { buildingId: found.id },
        select: { cellX: true, cellY: true },
        orderBy: [{ cellY: 'asc' }, { cellX: 'asc' }],
      });
      const releasedCells: readonly CellCoord[] = cellRows.map((row) => ({
        cellX: row.cellX,
        cellY: row.cellY,
      }));
      if (releasedCells.length > 0) {
        const released = await assignCellUse(services, tx, {
          world,
          playerId: auth.playerId,
          cells: releasedCells,
          landUse: LandUse.OWNED,
          buildingId: null,
          fromLandUse: [LandUse.BUILDING],
          atRealMs: reading.atRealMs,
        });
        if (!released.complete) {
          // Unreachable while the player row is locked: nothing else can move a cell of this
          // building. Stated rather than assumed, because leaving a cell pointing at a
          // disposed building would break the exclusivity CHECK of GDD section 15.
          throw new ApiError(ValidationCode.BUILDING_NOT_EMPTY, { entityId: found.id });
        }
      }

      await withConstraintTranslation(
        () =>
          tx.building.update({
            where: { id: found.id },
            data: { disposedGameMs: reading.gameNow },
          }),
        { buildingType: found.type, entityId: found.id },
      );

      // The resale value comes from the same shared rule the read model shows, so the refund
      // and the figure the panel quoted cannot differ (plan section 6.6, ADR-0014).
      const refund = buildingResaleValue(found.type);
      const refunded = await credit(tx, lock, {
        type: LedgerType.BUILDING_SALE,
        amount: refund,
        atGameMs: reading.gameNow,
        atRealMs: reading.atRealMs,
        idempotencyKey: requestKey(auth.playerId, 'building-sale', clientKey),
        refType: 'BUILDING',
        refId: found.id,
        meta: { buildingType: found.type, releasedCells: releasedCells.length },
      });

      const patches = await chunkPatchesFor(
        services,
        tx,
        world,
        chunksOfCells(releasedCells, world.chunkSize),
      );
      const farmDto = await buildFarmDto(tx, farm.id);
      const player = await buildPlayerDto(tx, auth.playerId, reading);

      context.emit(
        {
          type: 'BUILDING_REMOVED',
          payload: {
            buildingId: found.id as BuildingId,
            farmId: found.farmId as FarmId,
            releasedCells: [...releasedCells],
          },
        },
        { type: 'FARM_UPSERTED', payload: { farm: farmDto } },
        ...patches
          .filter((patch) => patch.cells.length > 0)
          .map((patch) => ({ type: 'CHUNK_PATCHED', payload: patch }) as const),
        { type: 'PLAYER_UPSERTED', payload: { player } },
        {
          type: 'LEDGER_APPENDED',
          payload: {
            entries: [toLedgerEntryDto(refunded.entry)],
            balance: toWireMoney(refunded.balanceAfter),
          },
        },
      );

      return {
        buildingId: found.id as BuildingId,
        farm: farmDto,
        refund: toWireMoney(refund),
        balanceAfter: toWireMoney(refunded.balanceAfter),
        releasedCells: [...releasedCells],
      };
    });

    const reply: RouteReply<'DELETE /api/buildings/:buildingId'> = {
      seq: outcome.seq,
      atGameMs: toWireGameMs(outcome.atGameMs),
      result: outcome.result,
    };
    return reply;
  });
}
