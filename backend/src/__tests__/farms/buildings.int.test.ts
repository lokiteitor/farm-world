// Placing a building: the geometry, the price and every refusal.
//
// Owner: workflow W4-B. Tests of the module `farms`.
//
// What this file pins down is the claim of GDD section 23, that a farm is a physical entity
// and not a menu. A garage is forty eight real cells that stop being available for a field,
// and the price of standing there is the resolution of GDD section 116 against GDD section
// 117 that plan section 2.2 and ADR-0011 fixed: the catalogue price when the plot is already
// the player's, and the catalogue price plus the cells of GDD section 115 when it is not.
//
// Every expected amount is rebuilt from `shared/config` and `shared/rules` rather than
// written as a literal, which is the rule the smoke test of plan section 10 states: an
// assertion against a literal stops testing the formula the moment the catalogue is retuned,
// and the catalogue is explicitly expected to be retuned after playtesting.
//
// The ground is searched and never assumed. The harness gives the run its own world with a
// random seed, so `terrain.ts` looks for a rectangle of grass and for a cell of water or
// mountain instead of hard coding a coordinate that would be valid under one seed only.

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ClockReading } from '../../lib/gameClock.js';
import { claimCells, loadSelectionCells } from '../../modules/world/service.js';
import {
  BUILDING_CATALOGUE,
  BuildingType,
  LandUse,
  Money,
  SelectionPurpose,
  TerrainType,
  ValidationCode,
  buildingResaleValue,
  cellPrice,
  multiplyByCount,
  validateSelection,
  type CellCoord,
  type PlayerId,
  type World,
} from '../../shared/index.js';
import { bearer, createHarness, registerViaHttp, type Harness } from '../harness.js';
import { findBuildableRectangle, findCellOfTerrain } from './terrain.js';

/** Chunk row this file reserves, so its buildings never meet another suite's. */
const BAND = 700;

let harness: Harness;
let reading: ClockReading;
let world: World;
let playerId: PlayerId;
let accessToken: string;
let farmId: string;

/** The capital a new player starts with (GDD section 117), read from the ledger. */
let startingBalance: Money;

beforeAll(async () => {
  harness = await createHarness();
  reading = await harness.services.clock.read();
  world = reading.world;
  const player = await registerViaHttp(harness, 'buildings');
  playerId = player.playerId;
  accessToken = player.accessToken;

  const created = await harness.app.inject({
    method: 'POST',
    url: '/api/farms',
    headers: bearer(accessToken),
    payload: { name: 'Granja del norte' },
  });
  expect(created.statusCode).toBe(200);
  farmId = created.json<{ result: { farm: { id: string } } }>().result.farm.id;

  const row = await harness.prisma.player.findUniqueOrThrow({
    where: { id: playerId },
    select: { balance: true },
  });
  startingBalance = Money.fromString(row.balance.toFixed(4));
});

afterAll(async () => {
  // `WorldCell.ownerPlayerId` and `WorldCell.buildingId` are both `onDelete: Restrict`, so
  // the cells and the chunks have to go before the player the harness deletes, and the
  // buildings before the farm they point at.
  await harness.prisma.worldCell.deleteMany({ where: { worldId: world.id } });
  await harness.prisma.chunk.deleteMany({ where: { worldId: world.id } });
  await harness.prisma.building.deleteMany({ where: { playerId } });
  await harness.prisma.farm.deleteMany({ where: { playerId } });
  await harness.teardown();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface PlaceBody {
  readonly type: BuildingType;
  readonly originCellX: number;
  readonly originCellY: number;
  readonly purchaseFootprintLand: boolean;
  readonly expectedTotal?: string;
}

async function place(body: PlaceBody): Promise<{
  statusCode: number;
  body: Record<string, unknown>;
}> {
  const response = await harness.app.inject({
    method: 'POST',
    url: `/api/farms/${farmId}/buildings`,
    headers: { ...bearer(accessToken), 'idempotency-key': randomUUID() },
    payload: body,
  });
  return { statusCode: response.statusCode, body: response.json() };
}

/** The cells the catalogue rectangle of a type covers from an origin. */
function footprintOf(type: BuildingType, origin: CellCoord): readonly CellCoord[] {
  const definition = BUILDING_CATALOGUE[type];
  const cells: CellCoord[] = [];
  for (let dy = 0; dy < definition.heightCells; dy += 1) {
    for (let dx = 0; dx < definition.widthCells; dx += 1) {
      cells.push({ cellX: origin.cellX + dx, cellY: origin.cellY + dy });
    }
  }
  return cells;
}

/** Buys cells for the player through the world service, which is what `land` will do. */
async function claim(cells: readonly CellCoord[]): Promise<number> {
  return harness.services.transaction(async (tx) => {
    const outcome = await claimCells(
      harness.services,
      tx,
      world,
      playerId,
      cells,
      harness.nowRealMs(),
    );
    return outcome.acquired.length;
  });
}

/** The error body of a refused request, so the assertions read as the contract does. */
function errorOf(body: Record<string, unknown>): {
  code: string;
  details?: Record<string, unknown>;
} {
  return (body as { error: { code: string; details?: Record<string, unknown> } }).error;
}

// ---------------------------------------------------------------------------
// The farm itself
// ---------------------------------------------------------------------------

describe('POST /api/farms', () => {
  it('crea una granja sin ocupar suelo ni mover dinero', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/farms',
      headers: bearer(accessToken),
      payload: { name: 'Granja secundaria' },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      seq: number;
      atGameMs: string;
      result: { farm: Record<string, unknown> };
    }>();

    // Sequenced: the reply carries the sequence the client feeds through its reducer.
    expect(body.seq).toBeGreaterThan(0);
    expect(BigInt(body.atGameMs)).toBeGreaterThan(0n);

    const farm = body.result.farm;
    expect(farm['name']).toBe('Granja secundaria');
    expect(farm['buildingCount']).toBe(0);
    expect(farm['hasWorkshop']).toBe(false);
    expect(farm['machineSlots']).toEqual({ used: 0, total: 0 });
    expect(farm['workerSlots']).toEqual({ used: 0, total: 0 });
    // No silo yet, so the capacity is zero and the occupancy is not a division by zero.
    expect(farm['wheat']).toEqual({
      storedUnits: 0,
      reservedUnits: 0,
      capacityUnits: 0,
      occupancyBp: 0,
    });

    // It cost nothing: the balance is untouched.
    const player = await harness.prisma.player.findUniqueOrThrow({
      where: { id: playerId },
      select: { balance: true },
    });
    expect(Money.fromString(player.balance.toFixed(4))).toBe(startingBalance);
  });
});

// ---------------------------------------------------------------------------
// Placing a building
// ---------------------------------------------------------------------------

describe('POST /api/farms/:farmId/buildings', () => {
  it('un garaje de 6 por 8 ocupa 48 celdas y cobra el catalogo mas el suelo', async () => {
    const definition = BUILDING_CATALOGUE[BuildingType.GARAGE];
    expect(definition.widthCells * definition.heightCells).toBe(48);
    expect(definition.footprintCells).toBe(48);

    const origin = await findBuildableRectangle(
      harness,
      world,
      definition.widthCells,
      definition.heightCells,
      BAND,
    );
    const before = await harness.prisma.player.findUniqueOrThrow({
      where: { id: playerId },
      select: { balance: true },
    });

    const placed = await place({
      type: BuildingType.GARAGE,
      originCellX: origin.cellX,
      originCellY: origin.cellY,
      purchaseFootprintLand: true,
    });
    expect(placed.statusCode).toBe(200);

    const result = (placed.body as { result: Record<string, unknown> }).result;
    const building = result['building'] as Record<string, unknown>;

    // The geometry: forty eight cells, and the rectangle of the catalogue.
    expect((result['footprintCells'] as unknown[]).length).toBe(48);
    expect(result['landPurchasedCells']).toBe(48);
    expect(building['widthCells']).toBe(definition.widthCells);
    expect(building['heightCells']).toBe(definition.heightCells);
    expect(building['capacity']).toBe(definition.capacity);
    expect(building['occupancy']).toBe(0);

    // The price: catalogue plus the cells of GDD section 115, since none were owned.
    const perCell = cellPrice(TerrainType.GRASS);
    expect(perCell).not.toBeNull();
    const expectedLand = multiplyByCount(perCell ?? Money.ZERO, 48);
    const expectedTotal = Money.add(definition.purchasePrice, expectedLand);
    expect(result['buildingPaid']).toBe(definition.purchasePrice);
    expect(result['landPaid']).toBe(expectedLand);
    expect(result['totalPaid']).toBe(expectedTotal);
    expect(result['balanceAfter']).toBe(
      Money.sub(Money.fromString(before.balance.toFixed(4)), expectedTotal),
    );

    // Two ledger entries and not one: the structure of GDD section 116 and the land of GDD
    // section 115 are different kinds, and the return summary aggregates by kind.
    const entries = await harness.prisma.ledgerEntry.findMany({
      where: { playerId, refType: 'BUILDING', refId: building['id'] as string },
      select: { type: true, amount: true },
    });
    expect(entries.map((entry) => entry.type).sort()).toEqual([
      'BUILDING_PURCHASE',
      'LAND_PURCHASE',
    ]);

    // The cells are the building's, and they are no longer available for a field (GDD 15).
    const cells = footprintOf(BuildingType.GARAGE, origin);
    const rows = await harness.prisma.worldCell.findMany({
      where: { buildingId: building['id'] as string },
      select: { landUse: true, ownerPlayerId: true },
    });
    expect(rows.length).toBe(48);
    expect(rows.every((row) => row.landUse === LandUse.BUILDING)).toBe(true);
    expect(rows.every((row) => row.ownerPlayerId === playerId)).toBe(true);

    const loaded = await loadSelectionCells(
      harness.services,
      harness.prisma,
      world,
      playerId,
      cells,
    );
    const asField = validateSelection({ purpose: SelectionPurpose.FIELD, cells: loaded });
    expect(asField.ok).toBe(false);
    expect(asField.validCellCount).toBe(0);
    expect(asField.issues.map((issue) => issue.code)).toContain(ValidationCode.CELL_IN_USE);
  });

  it('cobra solo el precio del catalogo cuando las celdas ya son del jugador', async () => {
    const definition = BUILDING_CATALOGUE[BuildingType.SILO];
    const origin = await findBuildableRectangle(
      harness,
      world,
      definition.widthCells,
      definition.heightCells,
      BAND + 1,
    );
    expect(await claim(footprintOf(BuildingType.SILO, origin))).toBe(definition.footprintCells);

    const before = await harness.prisma.player.findUniqueOrThrow({
      where: { id: playerId },
      select: { balance: true },
    });
    const placed = await place({
      type: BuildingType.SILO,
      originCellX: origin.cellX,
      originCellY: origin.cellY,
      // The safe default of a client that showed the player only the price of the building.
      purchaseFootprintLand: false,
    });
    expect(placed.statusCode).toBe(200);

    const result = (placed.body as { result: Record<string, unknown> }).result;
    expect(result['landPurchasedCells']).toBe(0);
    expect(result['landPaid']).toBe(Money.ZERO);
    expect(result['buildingPaid']).toBe(definition.purchasePrice);
    expect(result['totalPaid']).toBe(definition.purchasePrice);
    expect(result['balanceAfter']).toBe(
      Money.sub(Money.fromString(before.balance.toFixed(4)), definition.purchasePrice),
    );

    // The silo grants the farm its storage capacity, through the trigger and not through
    // the application (GDD section 27).
    const farm = (result['farm'] as { wheat: { capacityUnits: number } }).wheat;
    expect(farm.capacityUnits).toBe(definition.capacity);
  });

  it('rechaza una huella que solapa con un edificio ya construido', async () => {
    // The garage of the first test is where it is; a worker home anchored inside it overlaps.
    const garage = await harness.prisma.building.findFirstOrThrow({
      where: { playerId, type: BuildingType.GARAGE, disposedGameMs: null },
      select: { originCellX: true, originCellY: true },
    });
    const placed = await place({
      type: BuildingType.WORKER_HOME,
      originCellX: garage.originCellX + 1,
      originCellY: garage.originCellY + 1,
      purchaseFootprintLand: true,
    });
    expect(placed.statusCode).toBe(409);
    expect(errorOf(placed.body).code).toBe(ValidationCode.BUILDING_FOOTPRINT_OVERLAPS);
  });

  it('rechaza una huella sobre agua o montana', async () => {
    const blocked = await findCellOfTerrain(
      harness,
      world,
      [TerrainType.WATER, TerrainType.MOUNTAIN],
      BAND + 2,
    );
    const placed = await place({
      type: BuildingType.SILO,
      originCellX: blocked.cellX,
      originCellY: blocked.cellY,
      purchaseFootprintLand: true,
    });
    expect(placed.statusCode).toBe(409);
    // Not `TERRAIN_NOT_PURCHASABLE`: no amount of buying makes water buildable, and the
    // placement panel needs the answer that says so (GDD sections 8, 11 and 12).
    expect(errorOf(placed.body).code).toBe(ValidationCode.TERRAIN_NOT_BUILDABLE);
  });

  it('rechaza la fundacion cuando el jugador no tiene celdas suficientes', async () => {
    const definition = BUILDING_CATALOGUE[BuildingType.WORKSHOP];
    const origin = await findBuildableRectangle(
      harness,
      world,
      definition.widthCells,
      definition.heightCells,
      BAND + 3,
    );
    const placed = await place({
      type: BuildingType.WORKSHOP,
      originCellX: origin.cellX,
      originCellY: origin.cellY,
      purchaseFootprintLand: false,
    });
    expect(placed.statusCode).toBe(409);
    expect(errorOf(placed.body).code).toBe(ValidationCode.CELL_NOT_OWNED);

    // And nothing was written: a refused placement leaves no partial geometry.
    expect(
      await harness.prisma.worldCell.count({
        where: { worldId: world.id, cellX: origin.cellX, cellY: origin.cellY },
      }),
    ).toBe(0);
  });

  it('rechaza un presupuesto obsoleto en lugar de cobrarlo en silencio', async () => {
    const definition = BUILDING_CATALOGUE[BuildingType.WORKER_HOME];
    const origin = await findBuildableRectangle(
      harness,
      world,
      definition.widthCells,
      definition.heightCells,
      BAND + 4,
    );
    const placed = await place({
      type: BuildingType.WORKER_HOME,
      originCellX: origin.cellX,
      originCellY: origin.cellY,
      purchaseFootprintLand: true,
      expectedTotal: Money.fromUnits(1),
    });
    expect(placed.statusCode).toBe(400);
    const error = errorOf(placed.body);
    expect(error.code).toBe(ValidationCode.VALIDATION_FAILED);
    expect(error.details?.['field']).toBe('body.expectedTotal');
  });

  it('acepta el presupuesto cuando coincide con el que calcula el servidor', async () => {
    const definition = BUILDING_CATALOGUE[BuildingType.WORKER_HOME];
    const origin = await findBuildableRectangle(
      harness,
      world,
      definition.widthCells,
      definition.heightCells,
      BAND + 5,
    );
    const perCell = cellPrice(TerrainType.GRASS) ?? Money.ZERO;
    const expectedTotal = Money.add(
      definition.purchasePrice,
      multiplyByCount(perCell, definition.footprintCells),
    );
    const placed = await place({
      type: BuildingType.WORKER_HOME,
      originCellX: origin.cellX,
      originCellY: origin.cellY,
      purchaseFootprintLand: true,
      expectedTotal,
    });
    expect(placed.statusCode).toBe(200);
    expect((placed.body as { result: Record<string, unknown> }).result['totalPaid']).toBe(
      expectedTotal,
    );
  });
});

// ---------------------------------------------------------------------------
// The listing
// ---------------------------------------------------------------------------

describe('GET /api/farms', () => {
  it('devuelve las granjas del jugador con sus edificios y capacidades agregadas', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/farms',
      headers: bearer(accessToken),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      farms: { id: string; buildingCount: number; machineSlots: { total: number } }[];
      buildings: { id: string; farmId: string; type: string; resaleValue: string }[];
    }>();

    const farm = body.farms.find((entry) => entry.id === farmId);
    expect(farm).toBeDefined();
    const buildings = body.buildings.filter((entry) => entry.farmId === farmId);
    expect(farm?.buildingCount).toBe(buildings.length);

    // The garage is the only source of machine slots, and its capacity is the catalogue one.
    const garage = buildings.find((entry) => entry.type === BuildingType.GARAGE);
    expect(garage).toBeDefined();
    expect(farm?.machineSlots.total).toBe(BUILDING_CATALOGUE[BuildingType.GARAGE].capacity);

    // The resale value is the shared rule, so the figure the panel shows is the figure the
    // demolition credits.
    expect(garage?.resaleValue).toBe(buildingResaleValue(BuildingType.GARAGE));
  });
});
