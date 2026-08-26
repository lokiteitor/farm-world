// The internal capacity service and the demolition that changes what it reports.
//
// Owner: workflow W4-B. Tests of the module `farms`.
//
// `modules/farms/service.ts` is what `machinery`, `workers`, `economy`, `tasks` and
// `forestry` will ask "is there room". Those modules do not exist yet, so this file is what
// keeps their contract honest until they do: it drives the service directly, with the same
// rows the routes write, and asserts the four readings each of them depends on — garage
// slots (GDD section 96), home slots (GDD section 108), silo and wood store capacity (GDD
// sections 27 and 136), and the stock itself.
//
// The two halves are deliberately together. A capacity reading that is correct after a
// construction and wrong after a demolition is worse than no reading at all, because the
// only symptom is a purchase that should have been refused and was not.
//
// The occupancy counters are never written by this module: `Building.machineCount` is
// maintained by the trigger `machines_garage_occupancy` inside the same transaction, which
// is what makes two concurrent purchases with one free slot serialise on the row (plan
// section 5.4). The test inserts machines and reads the counter back, so a trigger that
// stopped firing would fail here and not three workflows later.

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ClockReading } from '../../lib/gameClock.js';
import {
  depositStorage,
  farmCapacities,
  loadBuildings,
  releaseStorageReservation,
  requireGarageSlot,
  requireHomeSlot,
  requireWorkshop,
  reserveStorage,
  storageCapacityError,
  withdrawStorage,
} from '../../modules/farms/service.js';
import {
  BUILDING_CATALOGUE,
  BuildingType,
  LandUse,
  Money,
  ValidationCode,
  buildingResaleValue,
  isApiError,
  type CellCoord,
  type PlayerId,
  type World,
} from '../../shared/index.js';
import { bearer, createHarness, registerViaHttp, type Harness } from '../harness.js';
import { findBuildableRectangle } from './terrain.js';

/** Chunk row this file reserves. */
const BAND = 760;

let harness: Harness;
let reading: ClockReading;
let world: World;
let playerId: PlayerId;
let accessToken: string;
let farmId: string;

/** The four buildings this file raises, by type. */
const built = new Map<BuildingType, string>();

beforeAll(async () => {
  harness = await createHarness();
  reading = await harness.services.clock.read();
  world = reading.world;
  const player = await registerViaHttp(harness, 'capacity');
  playerId = player.playerId;
  accessToken = player.accessToken;

  const created = await harness.app.inject({
    method: 'POST',
    url: '/api/farms',
    headers: bearer(accessToken),
    payload: { name: 'Granja de capacidades' },
  });
  expect(created.statusCode).toBe(200);
  farmId = created.json<{ result: { farm: { id: string } } }>().result.farm.id;

  // One strip of grass wide enough for the four buildings side by side. Their widths add up
  // to 6 + 4 + 4 + 5 = 19 and the tallest is 8, which is the minimum farm footprint of GDD
  // section 117 plus the workshop that section postpones.
  const strip = await findBuildableRectangle(harness, world, 19, 8, BAND);
  let cursorX = strip.cellX;
  for (const type of [
    BuildingType.GARAGE,
    BuildingType.SILO,
    BuildingType.WORKER_HOME,
    BuildingType.WORKSHOP,
  ]) {
    const definition = BUILDING_CATALOGUE[type];
    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/farms/${farmId}/buildings`,
      headers: { ...bearer(accessToken), 'idempotency-key': randomUUID() },
      payload: {
        type,
        originCellX: cursorX,
        originCellY: strip.cellY,
        purchaseFootprintLand: true,
      },
    });
    expect(response.statusCode).toBe(200);
    built.set(type, response.json<{ result: { building: { id: string } } }>().result.building.id);
    cursorX += definition.widthCells;
  }
});

afterAll(async () => {
  await harness.prisma.machine.deleteMany({ where: { playerId } });
  await harness.prisma.worldCell.deleteMany({ where: { worldId: world.id } });
  await harness.prisma.chunk.deleteMany({ where: { worldId: world.id } });
  await harness.prisma.building.deleteMany({ where: { playerId } });
  await harness.prisma.farm.deleteMany({ where: { playerId } });
  await harness.teardown();
});

/** The identifier of a building this file raised. */
function idOf(type: BuildingType): string {
  const id = built.get(type);
  if (id === undefined) {
    throw new Error(`El edificio ${type} no se construyo en el arranque de la suite`);
  }
  return id;
}

/** Parks a machine in the garage, which is what a purchase of workflow W5-A will do. */
async function parkMachine(garageId: string): Promise<void> {
  await harness.prisma.machine.create({
    data: {
      playerId,
      farmId,
      garageId,
      type: 'TRACTOR',
      conditionUpdatedAtGameMs: reading.gameNow,
      purchasePrice: '0',
      acquiredGameMs: reading.gameNow,
    },
    select: { id: true },
  });
}

/** The code of an `ApiError` a service call threw. */
async function codeOfRefusal(body: () => Promise<unknown>): Promise<string> {
  try {
    await body();
  } catch (error) {
    if (isApiError(error)) {
      return error.code;
    }
    throw error;
  }
  throw new Error('La llamada no fue rechazada');
}

// ---------------------------------------------------------------------------
// Readings after building
// ---------------------------------------------------------------------------

describe('el servicio de capacidades tras construir', () => {
  it('agrega las plazas de garaje y de vivienda y las capacidades de almacen', async () => {
    const capacities = await farmCapacities(harness.prisma, playerId, farmId);

    expect(capacities.machineSlots).toEqual({
      used: 0,
      total: BUILDING_CATALOGUE[BuildingType.GARAGE].capacity,
    });
    expect(capacities.workerSlots).toEqual({
      used: 0,
      total: BUILDING_CATALOGUE[BuildingType.WORKER_HOME].capacity,
    });
    expect(capacities.storage.GRAIN_LITERS.capacityUnits).toBe(
      BUILDING_CATALOGUE[BuildingType.SILO].capacity,
    );
    // No wood store was built, so there is no capacity for wood and no division by zero.
    expect(capacities.storage.WOOD_M3.capacityUnits).toBe(0);
    expect(capacities.storage.WOOD_M3.occupancyBp).toBe(0);
    expect(capacities.hasWorkshop).toBe(true);
    expect(capacities.buildingCount).toBe(4);
  });

  it('entrega la plaza libre de garaje y de vivienda que W5 consumira', async () => {
    const garage = await requireGarageSlot(harness.prisma, farmId);
    expect(garage.buildingId).toBe(idOf(BuildingType.GARAGE));
    expect(garage.used).toBe(0);
    expect(garage.total).toBe(BUILDING_CATALOGUE[BuildingType.GARAGE].capacity);

    const home = await requireHomeSlot(harness.prisma, farmId);
    expect(home.buildingId).toBe(idOf(BuildingType.WORKER_HOME));
    expect(home.total).toBe(BUILDING_CATALOGUE[BuildingType.WORKER_HOME].capacity);

    // The workshop is what repair requires (GDD sections 29 and 93) and it is there.
    await expect(requireWorkshop(harness.prisma, farmId)).resolves.toBeUndefined();
  });

  it('rechaza la quinta maquina en un garaje de cuatro plazas', async () => {
    const garageId = idOf(BuildingType.GARAGE);
    const capacity = BUILDING_CATALOGUE[BuildingType.GARAGE].capacity ?? 0;
    for (let index = 0; index < capacity; index += 1) {
      await parkMachine(garageId);
    }

    // The counter is the trigger's, not the application's.
    const row = await harness.prisma.building.findUniqueOrThrow({
      where: { id: garageId },
      select: { machineCount: true },
    });
    expect(row.machineCount).toBe(capacity);

    const code = await codeOfRefusal(() => requireGarageSlot(harness.prisma, farmId));
    expect(code).toBe(ValidationCode.GARAGE_CAPACITY_EXCEEDED);

    const capacities = await farmCapacities(harness.prisma, playerId, farmId);
    expect(capacities.machineSlots).toEqual({ used: capacity, total: capacity });
  });
});

// ---------------------------------------------------------------------------
// The stock
// ---------------------------------------------------------------------------

describe('las existencias de la granja', () => {
  it('reserva, deposita acotado y retira, sin poder rebasar la capacidad del silo', async () => {
    const capacity = BUILDING_CATALOGUE[BuildingType.SILO].capacity ?? 0;

    // Layer one: the reservation of plan section 5.4, taken when a harvest is assigned.
    const reserved = await harness.services.transaction((tx) =>
      reserveStorage(tx, farmId, 'WHEAT', 'GRAIN_LITERS', 1_000),
    );
    expect(reserved.ok).toBe(true);
    expect(reserved.usage.reservedUnits).toBe(1_000);

    // A reservation that does not fit is refused, which is what makes an overflow an
    // actionable rejection instead of a silent loss at completion (GDD sections 83 and 97).
    const tooBig = await harness.services.transaction((tx) =>
      reserveStorage(tx, farmId, 'WHEAT', 'GRAIN_LITERS', capacity),
    );
    expect(tooBig.ok).toBe(false);
    expect(tooBig.usage.reservedUnits).toBe(1_000);

    // Layer two: the bounded deposit. It releases the reservation and accepts what fits.
    const deposited = await harness.services.transaction((tx) =>
      depositStorage(tx, farmId, 'WHEAT', 'GRAIN_LITERS', 900, { releaseReservedUnits: 1_000 }),
    );
    expect(deposited.acceptedUnits).toBe(900);
    expect(deposited.wastedUnits).toBe(0);
    expect(deposited.usage.storedUnits).toBe(900);
    expect(deposited.usage.reservedUnits).toBe(0);

    // More than the silo holds: what fits is stored and the rest is reported as waste, never
    // as a constraint violation, because this path runs inside a completion job.
    const overflowed = await harness.services.transaction((tx) =>
      depositStorage(tx, farmId, 'WHEAT', 'GRAIN_LITERS', capacity),
    );
    expect(overflowed.acceptedUnits).toBe(capacity - 900);
    expect(overflowed.wastedUnits).toBe(900);
    expect(overflowed.usage.storedUnits).toBe(capacity);
    expect(overflowed.usage.occupancyBp).toBe(10_000);

    // And out again, for a sale.
    const sold = await harness.services.transaction((tx) =>
      withdrawStorage(tx, farmId, 'WHEAT', 'GRAIN_LITERS', capacity),
    );
    expect(sold.ok).toBe(true);
    expect(sold.usage.storedUnits).toBe(0);

    const empty = await harness.services.transaction((tx) =>
      withdrawStorage(tx, farmId, 'WHEAT', 'GRAIN_LITERS', 1),
    );
    expect(empty.ok).toBe(false);
    expect(empty.usage.storedUnits).toBe(0);
  });

  it('trata la ausencia de almacen como capacidad cero y no como un fallo', async () => {
    // The farm has no wood store, which is the state workflow W6-C meets before the player
    // builds one (GDD section 136). A reservation is refused and a deposit wastes everything,
    // both without touching a constraint.
    const reserved = await harness.services.transaction((tx) =>
      reserveStorage(tx, farmId, 'WOOD', 'WOOD_M3', 1),
    );
    expect(reserved.ok).toBe(false);
    expect(reserved.usage.capacityUnits).toBe(0);
    expect(storageCapacityError('WOOD_M3', reserved.usage, 1).code).toBe(
      ValidationCode.STORAGE_REQUIRED,
    );

    const deposited = await harness.services.transaction((tx) =>
      depositStorage(tx, farmId, 'WOOD', 'WOOD_M3', 100),
    );
    expect(deposited.acceptedUnits).toBe(0);
    expect(deposited.wastedUnits).toBe(100);
    expect(deposited.usage.storedUnits).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Demolition
// ---------------------------------------------------------------------------

describe('DELETE /api/buildings/:buildingId', () => {
  it('rechaza retirar un garaje que todavia guarda maquinaria', async () => {
    const response = await harness.app.inject({
      method: 'DELETE',
      url: `/api/buildings/${idOf(BuildingType.GARAGE)}`,
      headers: { ...bearer(accessToken), 'idempotency-key': randomUUID() },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe(
      ValidationCode.BUILDING_NOT_EMPTY,
    );
  });

  it('rechaza retirar un silo que todavia guarda grano', async () => {
    await harness.services.transaction((tx) =>
      depositStorage(tx, farmId, 'WHEAT', 'GRAIN_LITERS', 5_000),
    );
    const response = await harness.app.inject({
      method: 'DELETE',
      url: `/api/buildings/${idOf(BuildingType.SILO)}`,
      headers: { ...bearer(accessToken), 'idempotency-key': randomUUID() },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe(
      ValidationCode.BUILDING_NOT_EMPTY,
    );
    // Nothing moved: the silo is still there and still holds the grain.
    const capacities = await farmCapacities(harness.prisma, playerId, farmId);
    expect(capacities.storage.GRAIN_LITERS.storedUnits).toBe(5_000);
    expect(capacities.storage.GRAIN_LITERS.capacityUnits).toBe(
      BUILDING_CATALOGUE[BuildingType.SILO].capacity,
    );
  });

  it('retira un edificio vacio, devuelve el valor de reventa y libera las celdas', async () => {
    // Empty the silo first, which is the state the refusal above demands.
    await harness.services.transaction((tx) =>
      withdrawStorage(tx, farmId, 'WHEAT', 'GRAIN_LITERS', 5_000),
    );
    const siloId = idOf(BuildingType.SILO);
    const before = await harness.prisma.player.findUniqueOrThrow({
      where: { id: playerId },
      select: { balance: true },
    });

    const response = await harness.app.inject({
      method: 'DELETE',
      url: `/api/buildings/${siloId}`,
      headers: { ...bearer(accessToken), 'idempotency-key': randomUUID() },
    });
    expect(response.statusCode).toBe(200);
    const result = response.json<{
      result: {
        buildingId: string;
        refund: string;
        balanceAfter: string;
        releasedCells: CellCoord[];
        farm: { storage: { category: string; usage: { capacityUnits: number } }[] };
      };
    }>().result;

    const refund = buildingResaleValue(BuildingType.SILO);
    expect(result.buildingId).toBe(siloId);
    expect(result.refund).toBe(refund);
    expect(result.balanceAfter).toBe(
      Money.add(Money.fromString(before.balance.toFixed(4)), refund),
    );
    expect(result.releasedCells.length).toBe(BUILDING_CATALOGUE[BuildingType.SILO].footprintCells);
    // The trigger recomputed the farm capacity the moment the silo was disposed of.
    const grain = result.farm.storage.find((row) => row.category === 'GRAIN_LITERS');
    expect(grain?.usage.capacityUnits).toBe(0);

    // The cells are owned land again, with no use and no building, so a field may take them.
    const rows = await harness.prisma.worldCell.findMany({
      where: {
        worldId: world.id,
        OR: result.releasedCells.map((cell) => ({ cellX: cell.cellX, cellY: cell.cellY })),
      },
      select: { landUse: true, buildingId: true, ownerPlayerId: true },
    });
    expect(rows.length).toBe(BUILDING_CATALOGUE[BuildingType.SILO].footprintCells);
    expect(rows.every((row) => row.landUse === LandUse.OWNED)).toBe(true);
    expect(rows.every((row) => row.buildingId === null)).toBe(true);
    expect(rows.every((row) => row.ownerPlayerId === playerId)).toBe(true);

    // The row survives as a logical deletion, so the ledger entry that paid for it still
    // points at something (ADR-0009).
    const disposed = await harness.prisma.building.findUniqueOrThrow({
      where: { id: siloId },
      select: { disposedGameMs: true },
    });
    expect(disposed.disposedGameMs).not.toBeNull();

    // And the service no longer counts it.
    const capacities = await farmCapacities(harness.prisma, playerId, farmId);
    expect(capacities.storage.GRAIN_LITERS.capacityUnits).toBe(0);
    expect(capacities.buildingCount).toBe(3);
    const live = await loadBuildings(harness.prisma, [farmId]);
    expect(live.some((building) => building.id === siloId)).toBe(false);
  });

  it('rechaza retirar dos veces el mismo edificio', async () => {
    const response = await harness.app.inject({
      method: 'DELETE',
      url: `/api/buildings/${idOf(BuildingType.SILO)}`,
      headers: { ...bearer(accessToken), 'idempotency-key': randomUUID() },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json<{ error: { code: string } }>().error.code).toBe(ValidationCode.NOT_FOUND);
  });

  it('deja de exigir taller cuando el taller se retira', async () => {
    const workshopId = idOf(BuildingType.WORKSHOP);
    const response = await harness.app.inject({
      method: 'DELETE',
      url: `/api/buildings/${workshopId}`,
      headers: { ...bearer(accessToken), 'idempotency-key': randomUUID() },
    });
    expect(response.statusCode).toBe(200);

    const capacities = await farmCapacities(harness.prisma, playerId, farmId);
    expect(capacities.hasWorkshop).toBe(false);
    const code = await codeOfRefusal(() => requireWorkshop(harness.prisma, farmId));
    expect(code).toBe(ValidationCode.WORKSHOP_REQUIRED);
  });

  it('libera capacidad de vivienda al retirarla y deja la granja sin plazas', async () => {
    const homeId = idOf(BuildingType.WORKER_HOME);
    const response = await harness.app.inject({
      method: 'DELETE',
      url: `/api/buildings/${homeId}`,
      headers: { ...bearer(accessToken), 'idempotency-key': randomUUID() },
    });
    expect(response.statusCode).toBe(200);

    const capacities = await farmCapacities(harness.prisma, playerId, farmId);
    expect(capacities.workerSlots).toEqual({ used: 0, total: 0 });
    const code = await codeOfRefusal(() => requireHomeSlot(harness.prisma, farmId));
    expect(code).toBe(ValidationCode.HOME_CAPACITY_EXCEEDED);

    // A leftover reservation is released without ever taking the column below zero.
    const released = await harness.services.transaction((tx) =>
      releaseStorageReservation(tx, farmId, 'WOOD', 'WOOD_M3', 10),
    );
    expect(released.reservedUnits).toBe(0);
  });
});
