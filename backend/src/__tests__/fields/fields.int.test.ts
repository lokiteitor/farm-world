// The `fields` area against a real PostgreSQL and a real Redis.
//
// Owner: workflow W4-C. Module `fields`.
//
// What this file pins down is the part of the module that only a real database can show:
// the geometry refusals of GDD section 17, which depend on the effective terrain and on the
// exclusivity of use of the cell; the conservation of the cell count across a split and a
// merge of GDD sections 21 and 22; and the property the whole hybrid model of plan section
// 6.5 rests on, namely that the scheduled job and the projection reach the same row and
// that applying either of them twice changes nothing.
//
// Fixture of the terrain. The seed of a run is random, so a contiguous strip of grass
// thirty six cells long across three chunks cannot be found by searching: with about 59 %
// grass the probability is nil. The cells are therefore claimed and then given
// `terrainOverride = GRASS`, which is exactly what `CLEAR_LAND` of GDD section 10 writes and
// what the world suite already uses to exercise the effective terrain. The one test that
// needs water searches for a real water cell instead, because there the generator is the
// point.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { advancePlayerNow, withPlayerAdvanced } from '../../lib/advancePlayer.js';
import { type ClockReading } from '../../lib/gameClock.js';
import {
  applyFieldOperation,
  fieldUpsertedFrame,
  materializeProjectedPhase,
  requireField,
} from '../../modules/fields/service.js';
import { terrainCacheOf } from '../../modules/world/generator.js';
import { assignCellUse, claimCells } from '../../modules/world/service.js';
import {
  CropCycleState,
  LandUse,
  ScheduledEventKind,
  ScheduledEventStatus,
  TERRAIN_CODE,
  TerrainType,
  ValidationCode,
  WHEAT,
  worldFromChunk,
  type CellCoord,
  type FieldId,
  type PlayerId,
  type World,
} from '../../shared/index.js';
import {
  bearer,
  createFarmFixture,
  createHarness,
  registerViaHttp,
  type Harness,
} from '../harness.js';

let harness: Harness;
let reading: ClockReading;
let world: World;
let playerId: PlayerId;
let accessToken: string;
let otherPlayerId: PlayerId;
let otherAccessToken: string;

/** Every player the file created, so the teardown can clear their fields and farms. */
const players: PlayerId[] = [];

/** Chunk row nothing else in the suite touches, so the tests cannot interfere. */
const BASE_CHUNK_Y = 700;
/**
 * Chunk row the narrative cycle uses, which needs a rectangle twenty five rows tall and
 * therefore cannot share the band the four row spacing of `row` carves up.
 */
const NARRATIVE_Y = (BASE_CHUNK_Y + 10) * 32;
/** Chunk row the water search walks. */
const WATER_CHUNK_Y = 760;

/** Absolute cell row of a test, four rows apart so two rectangles never touch. */
function row(index: number): number {
  return BASE_CHUNK_Y * 32 + index * 4;
}

/** A rectangle of cells, row major. */
function rect(originX: number, originY: number, width: number, height: number): CellCoord[] {
  const cells: CellCoord[] = [];
  for (let dy = 0; dy < height; dy += 1) {
    for (let dx = 0; dx < width; dx += 1) {
      cells.push({ cellX: originX + dx, cellY: originY + dy });
    }
  }
  return cells;
}

/**
 * Buys a set of cells for a player and makes their effective terrain grass.
 *
 * The override is what `CLEAR_LAND` of GDD section 10 writes, and using it keeps the fixture
 * independent of the random seed of the run.
 */
async function ownGrass(owner: PlayerId, cells: readonly CellCoord[]): Promise<void> {
  await harness.services.transaction(async (tx) => {
    await claimCells(harness.services, tx, world, owner, cells, harness.nowRealMs());
  });
  await harness.prisma.worldCell.updateMany({
    where: {
      worldId: world.id,
      OR: cells.map((cell) => ({ cellX: cell.cellX, cellY: cell.cellY })),
    },
    data: { terrainOverride: TerrainType.GRASS },
  });
}

interface JsonResponse {
  readonly statusCode: number;
  readonly body: Record<string, unknown>;
}

async function post(url: string, payload: unknown, token = accessToken): Promise<JsonResponse> {
  const response = await harness.app.inject({
    method: 'POST',
    url,
    headers: bearer(token),
    payload: payload as never,
  });
  return { statusCode: response.statusCode, body: response.json<Record<string, unknown>>() };
}

async function get(url: string, token = accessToken): Promise<JsonResponse> {
  const response = await harness.app.inject({ method: 'GET', url, headers: bearer(token) });
  return { statusCode: response.statusCode, body: response.json<Record<string, unknown>>() };
}

/** The `result` of a mutating reply, which every sequenced route wraps. */
function resultOf(response: JsonResponse): Record<string, unknown> {
  return response.body['result'] as Record<string, unknown>;
}

function errorCodeOf(response: JsonResponse): string {
  return (response.body['error'] as Record<string, unknown>)['code'] as string;
}

/** Creates a field over the cells and returns the reply, without asserting anything. */
async function createField(
  name: string,
  cells: readonly CellCoord[],
  token = accessToken,
): Promise<JsonResponse> {
  return post('/api/fields', { name, farmId: null, cells }, token);
}

/** Creates a field and returns its identifier, failing loudly if the creation was refused. */
async function createFieldOk(name: string, cells: readonly CellCoord[]): Promise<FieldId> {
  const response = await createField(name, cells);
  expect(response.statusCode, JSON.stringify(response.body)).toBe(200);
  const field = resultOf(response)['field'] as Record<string, unknown>;
  return field['id'] as FieldId;
}

/**
 * Applies a completed operation to a field, which is what `modules/tasks` of workflow W6-A
 * will do when the task engine lands. Until then this is the only way to drive the cycle,
 * and it goes through the same public function.
 */
async function operate(
  owner: PlayerId,
  fieldId: FieldId,
  operation: 'PLOW' | 'CULTIVATE' | 'SEED' | 'HARVEST',
  cropId: 'WHEAT' | null = null,
): Promise<{ readonly state: CropCycleState; readonly harvestedLiters: number | null }> {
  const outcome = await withPlayerAdvanced(harness.services, owner, async (context) => {
    const field = await requireField(context.tx, owner, fieldId);
    const applied = await applyFieldOperation(context.tx, context.outbox, context.reading, field, {
      operation,
      cropId,
    });
    context.emit(fieldUpsertedFrame(applied.field, context.reading.gameNow, null));
    return applied;
  });
  return {
    state: outcome.result.field.cropCycleState,
    harvestedLiters: outcome.result.harvestedLiters,
  };
}

/** A cell of the generated world whose terrain GDD section 17 excludes from a field. */
interface NonArableCell {
  readonly cell: CellCoord;
  readonly terrain: TerrainType;
}

/**
 * Finds a cell of natural water or of mountain, preferring water.
 *
 * The seed of a run is random and the share of water in one region swings between about
 * 0,9 % and 3 % for mountain and around 10 % for water on the whole generator (ADR-0010), so
 * a strip of a dozen chunks is not a safe place to look. Two hundred chunks are, and either
 * of the two terrains proves the same rule.
 */
async function findNonArableCell(): Promise<NonArableCell | null> {
  const cache = terrainCacheOf(harness.services);
  let fallback: NonArableCell | null = null;
  for (let chunkY = WATER_CHUNK_Y; chunkY < WATER_CHUNK_Y + 10; chunkY += 1) {
    for (let chunkX = 0; chunkX < 20; chunkX += 1) {
      const bytes = await cache.chunk(world, { chunkX, chunkY });
      for (let index = 0; index < bytes.length; index += 1) {
        const code = bytes[index];
        if (code === TERRAIN_CODE.WATER) {
          return {
            cell: worldFromChunk({ chunkX, chunkY }, index, world.chunkSize),
            terrain: TerrainType.WATER,
          };
        }
        if (code === TERRAIN_CODE.MOUNTAIN && fallback === null) {
          fallback = {
            cell: worldFromChunk({ chunkX, chunkY }, index, world.chunkSize),
            terrain: TerrainType.MOUNTAIN,
          };
        }
      }
    }
  }
  return fallback;
}

/** The stored row of a field, read straight from the database. */
async function readRow(fieldId: FieldId): Promise<Record<string, unknown>> {
  const found = await harness.prisma.field.findUniqueOrThrow({
    where: { id: fieldId },
    select: {
      cropCycleState: true,
      stateEnteredAtGameMs: true,
      seededAtGameMs: true,
      weedLevelBp: true,
      weedLevelUpdatedAtGameMs: true,
      fertilityBp: true,
      fertilityUpdatedAtGameMs: true,
      cellCount: true,
    },
  });
  return { ...found };
}

/**
 * A player of its own, which several tests need.
 *
 * `advancePlayerNow` applies every event of a player that has fallen due, so a test that
 * counts processed events has to be the only owner of its fields. Sharing one player would
 * make those counts depend on the order the file happens to run in.
 */
async function register(label: string): Promise<{
  readonly playerId: PlayerId;
  readonly accessToken: string;
}> {
  const created = await registerViaHttp(harness, label);
  players.push(created.playerId);
  return { playerId: created.playerId, accessToken: created.accessToken };
}

/**
 * A fresh access token for a player.
 *
 * The injected clock is the one the token verifier reads, so moving it forward by ninety
 * six game hours expires a token that was issued fifteen real minutes ago in its own frame.
 * That is correct behaviour and not a defect of the harness: the session lives in real time
 * and the multiplier of this world is one to one.
 */
async function login(label: string): Promise<string> {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: harness.email(label), password: 'contrasena-de-prueba' },
  });
  if (response.statusCode !== 200) {
    throw new Error(`Login failed with ${response.statusCode}: ${response.body}`);
  }
  return response.json<Record<string, unknown>>()['accessToken'] as string;
}

beforeAll(async () => {
  harness = await createHarness();
  reading = await harness.services.clock.read();
  world = reading.world;
  const main = await register('fields');
  playerId = main.playerId;
  accessToken = main.accessToken;
  const other = await register('fields-other');
  otherPlayerId = other.playerId;
  otherAccessToken = other.accessToken;
});

afterAll(async () => {
  // `world_cells` points at fields and at players with `onDelete: Restrict`, so the grid has
  // to go before anything that owns it (`docs/handoff/NOTES-w3-cierre.md`, and the same two
  // lines the world suite needs).
  await harness.prisma.worldCell.deleteMany({ where: { worldId: world.id } });
  await harness.prisma.chunk.deleteMany({ where: { worldId: world.id } });
  await harness.prisma.field.deleteMany({ where: { playerId: { in: players } } });
  await harness.prisma.building.deleteMany({ where: { playerId: { in: players } } });
  await harness.prisma.farm.deleteMany({ where: { playerId: { in: players } } });
  await harness.teardown();
});

describe('POST /api/fields — creacion (GDD 17 y 19)', () => {
  it('rechaza celdas que no son del jugador', async () => {
    const cells = rect(0, row(0), 3, 1);
    const response = await createField('Campo ajeno', cells);
    expect(response.statusCode).toBe(409);
    expect(errorCodeOf(response)).toBe(ValidationCode.CELL_NOT_OWNED);
    expect(await harness.prisma.field.count({ where: { playerId } })).toBe(0);
  });

  it('rechaza celdas del jugador sobre agua o montana', async () => {
    // Aqui el generador es justamente lo que se comprueba, de modo que la celda se busca y
    // no se fabrica con `terrainOverride`. La semilla de la ejecucion es aleatoria y la
    // cuota de agua de una region concreta oscila (ADR-0010), asi que se recorre un bloque
    // de doscientos chunks y se acepta cualquiera de los dos terrenos que la seccion 17
    // excluye, prefiriendo el agua.
    const found = await findNonArableCell();
    expect(
      found,
      'el generador no produjo agua ni montana en el bloque inspeccionado',
    ).not.toBeNull();
    const cell = found?.cell ?? { cellX: 0, cellY: 0 };
    expect([TerrainType.WATER, TerrainType.MOUNTAIN]).toContain(found?.terrain);

    await harness.services.transaction(async (tx) => {
      await claimCells(harness.services, tx, world, playerId, [cell], harness.nowRealMs());
    });
    const response = await createField('Campo anegado', [cell]);
    expect(response.statusCode).toBe(409);
    expect(errorCodeOf(response)).toBe(ValidationCode.TERRAIN_NOT_ARABLE);
  });

  it('rechaza celdas ocupadas por la huella de una granja', async () => {
    const cells = rect(0, row(2), 4, 1);
    await ownGrass(playerId, cells);
    const farm = await createFarmFixture(harness, playerId, reading.gameNow);
    const assigned = await harness.services.transaction((tx) =>
      assignCellUse(harness.services, tx, {
        world,
        playerId,
        cells,
        landUse: LandUse.BUILDING,
        buildingId: farm.homeId,
        atRealMs: harness.nowRealMs(),
      }),
    );
    expect(assigned.complete).toBe(true);

    const response = await createField('Campo sobre la granja', cells);
    expect(response.statusCode).toBe(409);
    expect(errorCodeOf(response)).toBe(ValidationCode.CELL_IN_USE);
  });

  it('rechaza una seleccion no contigua', async () => {
    const left = rect(0, row(4), 2, 1);
    const right = rect(10, row(4), 2, 1);
    await ownGrass(playerId, [...left, ...right]);

    const response = await createField('Campo partido', [...left, ...right]);
    expect(response.statusCode).toBe(400);
    expect(errorCodeOf(response)).toBe(ValidationCode.SELECTION_NOT_CONTIGUOUS);
  });

  it('crea un campo multi chunk que abarca tres chunks con el recuento correcto', async () => {
    // De la celda 30 a la 65 de la misma fila: chunks 0, 1 y 2 (GDD 16 y 18).
    const cells = rect(30, row(6), 36, 1);
    await ownGrass(playerId, cells);

    const fieldId = await createFieldOk('Campo multi chunk', cells);
    const detail = await get(`/api/fields/${fieldId}`);
    expect(detail.statusCode).toBe(200);
    const field = detail.body['field'] as Record<string, unknown>;
    // La superficie sale del recuento de celdas y de nada mas (GDD 18).
    expect(field['cellCount']).toBe(36);
    expect((detail.body['cells'] as unknown[]).length).toBe(36);

    const owned = await harness.prisma.worldCell.findMany({
      where: { fieldId },
      select: { chunkX: true, chunkY: true, landUse: true },
    });
    expect(owned).toHaveLength(36);
    expect(owned.every((cell) => cell.landUse === LandUse.FIELD)).toBe(true);
    const chunks = new Set(owned.map((cell) => `${cell.chunkX}:${cell.chunkY}`));
    expect(chunks.size).toBe(3);
    expect([...chunks].sort()).toEqual([
      `0:${BASE_CHUNK_Y}`,
      `1:${BASE_CHUNK_Y}`,
      `2:${BASE_CHUNK_Y}`,
    ]);
  });

  it('devuelve el campo en el listado, con su estado inicial y su proyeccion', async () => {
    const listing = await get('/api/fields');
    expect(listing.statusCode).toBe(200);
    const fields = listing.body['fields'] as Record<string, unknown>[];
    expect(fields.length).toBeGreaterThan(0);
    const multiChunk = fields.find((field) => field['name'] === 'Campo multi chunk');
    expect(multiChunk).toBeDefined();
    expect(multiChunk?.['cropCycleState']).toBe(CropCycleState.VIRGIN);
    expect(multiChunk?.['cropId']).toBeNull();
    const projection = multiChunk?.['projection'] as Record<string, unknown>;
    expect(projection['cropCycleState']).toBe(CropCycleState.VIRGIN);
    expect(projection['fertilityBp']).toBe(10_000);
    expect(projection['availableOperations']).toEqual(['PLOW']);
    // El listado no lleva geometria; el detalle si (contrato de `shared/api/schemas`).
    expect(multiChunk?.['cells']).toBeUndefined();
  });

  it('rechaza el detalle de un campo de otro jugador', async () => {
    const cells = rect(0, row(8), 2, 1);
    await ownGrass(otherPlayerId, cells);
    const created = await createField('Campo del otro', cells, otherAccessToken);
    expect(created.statusCode).toBe(200);
    const fieldId = (resultOf(created)['field'] as Record<string, unknown>)['id'] as string;

    const response = await get(`/api/fields/${fieldId}`);
    expect(response.statusCode).toBe(403);
    expect(errorCodeOf(response)).toBe(ValidationCode.NOT_OWNED);
  });
});

describe('POST /api/fields/:fieldId/extend — ampliacion (GDD 20)', () => {
  it('rechaza celdas que no son adyacentes al campo', async () => {
    const base = rect(0, row(10), 2, 2);
    const far = rect(20, row(10), 2, 1);
    await ownGrass(playerId, [...base, ...far]);
    const fieldId = await createFieldOk('Campo a ampliar', base);

    const response = await post(`/api/fields/${fieldId}/extend`, { cells: far });
    expect(response.statusCode).toBe(400);
    expect(errorCodeOf(response)).toBe(ValidationCode.SELECTION_NOT_ADJACENT);
    const row0 = await readRow(fieldId);
    expect(row0['cellCount']).toBe(4);
  });

  it('amplia con celdas adyacentes y actualiza el recuento', async () => {
    const base = rect(0, row(12), 2, 2);
    const next = rect(2, row(12), 2, 2);
    await ownGrass(playerId, [...base, ...next]);
    const fieldId = await createFieldOk('Campo ampliable', base);

    const response = await post(`/api/fields/${fieldId}/extend`, { cells: next });
    expect(response.statusCode, JSON.stringify(response.body)).toBe(200);
    const field = resultOf(response)['field'] as Record<string, unknown>;
    expect(field['cellCount']).toBe(8);
    expect((resultOf(response)['cells'] as unknown[]).length).toBe(8);
    expect(await harness.prisma.worldCell.count({ where: { fieldId } })).toBe(8);
  });

  it('rechaza ampliar un campo que ya esta sembrado', async () => {
    const base = rect(0, row(14), 2, 2);
    const next = rect(2, row(14), 2, 2);
    await ownGrass(playerId, [...base, ...next]);
    const fieldId = await createFieldOk('Campo sembrado', base);
    await operate(playerId, fieldId, 'PLOW');
    await operate(playerId, fieldId, 'SEED', 'WHEAT');

    const response = await post(`/api/fields/${fieldId}/extend`, { cells: next });
    expect(response.statusCode).toBe(409);
    expect(errorCodeOf(response)).toBe(ValidationCode.FIELD_STATE_NOT_ALLOWED);
  });
});

describe('division y fusion (GDD 21 y 22)', () => {
  it('la division conserva la suma de celdas y deja las dos mitades contiguas', async () => {
    const cells = rect(0, row(16), 4, 2);
    await ownGrass(playerId, cells);
    const fieldId = await createFieldOk('Campo a dividir', cells);
    const moved = cells.filter((cell) => cell.cellX >= 2);

    const response = await post(`/api/fields/${fieldId}/split`, {
      name: 'Mitad este',
      cells: moved,
    });
    expect(response.statusCode, JSON.stringify(response.body)).toBe(200);
    const original = resultOf(response)['original'] as Record<string, unknown>;
    const created = resultOf(response)['created'] as Record<string, unknown>;
    expect(original['cellCount']).toBe(4);
    expect(created['cellCount']).toBe(4);
    expect(Number(original['cellCount']) + Number(created['cellCount'])).toBe(cells.length);

    const createdId = created['id'] as FieldId;
    expect(await harness.prisma.worldCell.count({ where: { fieldId } })).toBe(4);
    expect(await harness.prisma.worldCell.count({ where: { fieldId: createdId } })).toBe(4);
  });

  it('rechaza una division que dejaria una mitad no contigua', async () => {
    const cells = rect(0, row(18), 4, 1);
    await ownGrass(playerId, cells);
    const fieldId = await createFieldOk('Campo indivisible', cells);
    // Llevarse la celda del medio parte el resto en dos.
    const moved = [cells[1] ?? cells[0]].filter((cell): cell is CellCoord => cell !== undefined);

    const response = await post(`/api/fields/${fieldId}/split`, { name: 'Trozo', cells: moved });
    expect(response.statusCode).toBe(400);
    expect(errorCodeOf(response)).toBe(ValidationCode.FIELD_SPLIT_INCOMPLETE);
    expect(await harness.prisma.worldCell.count({ where: { fieldId } })).toBe(4);
  });

  it('la fusion conserva la suma de celdas y retira los campos absorbidos', async () => {
    const left = rect(0, row(20), 3, 1);
    const right = rect(3, row(20), 2, 1);
    await ownGrass(playerId, [...left, ...right]);
    const leftId = await createFieldOk('Parcela izquierda', left);
    const rightId = await createFieldOk('Parcela derecha', right);

    const response = await post('/api/fields/merge', {
      name: 'Parcela unica',
      fieldIds: [leftId, rightId],
    });
    expect(response.statusCode, JSON.stringify(response.body)).toBe(200);
    const merged = resultOf(response)['field'] as Record<string, unknown>;
    expect(merged['id']).toBe(leftId);
    expect(merged['name']).toBe('Parcela unica');
    expect(merged['cellCount']).toBe(left.length + right.length);
    expect(resultOf(response)['removedFieldIds']).toEqual([rightId]);

    expect(await harness.prisma.worldCell.count({ where: { fieldId: leftId } })).toBe(5);
    expect(await harness.prisma.worldCell.count({ where: { fieldId: rightId } })).toBe(0);
    // El campo absorbido queda con borrado logico. Conserva su `cellCount` porque
    // `fields_geometry_check` exige un recuento positivo y porque una fila con borrado
    // logico registra lo que la entidad fue; la geometria que posee de verdad es cero
    // celdas, y eso ya lo dice `world_cells`.
    const absorbed = await harness.prisma.field.findUniqueOrThrow({
      where: { id: rightId },
      select: { disposedGameMs: true, cellCount: true },
    });
    expect(absorbed.disposedGameMs).not.toBeNull();
    expect(absorbed.cellCount).toBe(right.length);

    // Y deja de aparecer en el listado, que solo lleva campos vivos.
    const listing = await get('/api/fields');
    const names = (listing.body['fields'] as Record<string, unknown>[]).map((field) => field['id']);
    expect(names).toContain(leftId);
    expect(names).not.toContain(rightId);
  });

  it('rechaza fusionar campos que no son contiguos entre si', async () => {
    const left = rect(0, row(22), 2, 1);
    const right = rect(10, row(22), 2, 1);
    await ownGrass(playerId, [...left, ...right]);
    const leftId = await createFieldOk('Lejana A', left);
    const rightId = await createFieldOk('Lejana B', right);

    const response = await post('/api/fields/merge', {
      name: 'Imposible',
      fieldIds: [leftId, rightId],
    });
    expect(response.statusCode).toBe(400);
    expect(errorCodeOf(response)).toBe(ValidationCode.SELECTION_NOT_CONTIGUOUS);
  });

  it('rechaza fusionar campos en fases distintas del ciclo', async () => {
    const left = rect(0, row(24), 2, 1);
    const right = rect(2, row(24), 2, 1);
    await ownGrass(playerId, [...left, ...right]);
    const leftId = await createFieldOk('Arada', left);
    const rightId = await createFieldOk('Virgen', right);
    await operate(playerId, leftId, 'PLOW');

    const response = await post('/api/fields/merge', {
      name: 'Mezcla',
      fieldIds: [leftId, rightId],
    });
    expect(response.statusCode).toBe(409);
    expect(errorCodeOf(response)).toBe(ValidationCode.FIELD_MERGE_INCOMPATIBLE);
    // Nada se destruyo: los dos campos siguen ahi con sus celdas.
    expect(await harness.prisma.worldCell.count({ where: { fieldId: leftId } })).toBe(2);
    expect(await harness.prisma.worldCell.count({ where: { fieldId: rightId } })).toBe(2);
  });
});

describe('la maquina de estados (GDD 76)', () => {
  it('rechaza una transicion ilegal', async () => {
    const cells = rect(0, row(26), 2, 1);
    await ownGrass(playerId, cells);
    const fieldId = await createFieldOk('Campo virgen', cells);

    await expect(operate(playerId, fieldId, 'HARVEST')).rejects.toMatchObject({
      code: ValidationCode.FIELD_STATE_NOT_ALLOWED,
    });
    expect((await readRow(fieldId))['cropCycleState']).toBe(CropCycleState.VIRGIN);
  });

  it('agenda el evento de crecimiento al sembrar y lo retira al cosechar', async () => {
    const cells = rect(0, row(28), 2, 1);
    await ownGrass(playerId, cells);
    const fieldId = await createFieldOk('Campo agendado', cells);
    await operate(playerId, fieldId, 'PLOW');
    await operate(playerId, fieldId, 'SEED', 'WHEAT');

    const pending = await harness.prisma.scheduledEvent.findMany({
      where: {
        playerId,
        refType: 'FIELD',
        refId: fieldId,
        status: ScheduledEventStatus.PENDING,
      },
      select: { kind: true, dueGameMs: true },
    });
    expect(pending).toHaveLength(1);
    expect(pending[0]?.kind).toBe(ScheduledEventKind.FIELD_ADVANCE_PHASE);
    // La primera frontera del ciclo son las seis horas de `SEEDED` (GDD 76 y 82).
    const seeded = (await readRow(fieldId))['seededAtGameMs'] as bigint;
    expect(pending[0]?.dueGameMs).toBe(seeded + 6n * 3_600_000n);
  });
});

describe('el ejemplo narrativo de la seccion 84, extremo a extremo', () => {
  it('recorre el ciclo completo con el reloj inyectado', async () => {
    // Jugador propio: `advancePlayerNow` aplica todo lo vencido del jugador, de modo que
    // contar eventos procesados solo tiene sentido si este campo es el unico suyo.
    const narrator = await register('narrativa');
    const cells = rect(0, NARRATIVE_Y, 10, 25);
    expect(cells).toHaveLength(250);
    await ownGrass(narrator.playerId, cells);
    const created = await createField('Field #12', cells, narrator.accessToken);
    expect(created.statusCode, JSON.stringify(created.body)).toBe(200);
    const fieldId = (resultOf(created)['field'] as Record<string, unknown>)['id'] as FieldId;

    // Dia 1: VIRGIN, fertilidad 100 %, malezas 0 %.
    const start = await readRow(fieldId);
    expect(start['cropCycleState']).toBe(CropCycleState.VIRGIN);
    expect(start['fertilityBp']).toBe(10_000);
    expect(start['weedLevelBp']).toBe(0);

    expect((await operate(narrator.playerId, fieldId, 'PLOW')).state).toBe(CropCycleState.PLOWED);
    expect((await operate(narrator.playerId, fieldId, 'SEED', 'WHEAT')).state).toBe(
      CropCycleState.SEEDED,
    );

    // Seis horas despues, desconectado: el trabajo agendado materializa GERMINATING.
    harness.advanceGameHours(6);
    const first = await advancePlayerNow(harness.services, narrator.playerId);
    expect(first.processedEvents).toBeGreaterThanOrEqual(1);
    // La metrica de eventos sin manejador no cuenta los de este modulo: esta registrado de
    // verdad y no queda como andamiaje (`docs/handoff/NOTES-w3-cierre.md`, apartado 8).
    expect(first.unhandledEvents).toBe(0);
    expect((await readRow(fieldId))['cropCycleState']).toBe(CropCycleState.GERMINATING);

    // Noventa horas mas. La sesion caduca en tiempo real y el reloj inyectado es el que el
    // verificador lee, de modo que hay que renovarla antes de volver por HTTP.
    harness.advanceGameHours(90);
    const token = await login('narrativa');
    const detail = await get(`/api/fields/${fieldId}`, token);
    expect(detail.statusCode, JSON.stringify(detail.body)).toBe(200);
    const projection = (detail.body['field'] as Record<string, unknown>)['projection'] as Record<
      string,
      unknown
    >;
    expect(projection['cropCycleState']).toBe(CropCycleState.READY_TO_HARVEST);
    expect(projection['growthProgressBp']).toBe(10_000);
    // DESVIACION DOCUMENTADA (plan 2.2): la seccion 84 narra un 34 % de malezas; con la
    // tasa literal de la seccion 82, 0,6 %/h, las 78 h de GROWING dan el 46,8 %.
    expect(projection['weedLevelBp']).toBe(4_680);
    expect(projection['expectedYieldLiters']).toBe(18_288);
    expect(projection['availableOperations']).toEqual(['HARVEST']);

    // El jugador cosecha. La validacion acepta el campo porque la proyeccion dice que ya
    // llego, y la transicion se materializa en la misma transaccion.
    const harvest = await operate(narrator.playerId, fieldId, 'HARVEST');
    expect(harvest.harvestedLiters).toBe(18_288);
    // HARVESTED -> VIRGIN es automatica y ocurre en el mismo acto (GDD 76 y 84).
    expect(harvest.state).toBe(CropCycleState.VIRGIN);

    const after = await readRow(fieldId);
    expect(after['fertilityBp']).toBe(10_000 - WHEAT.fertilityDrainPerCycleBp);
    // La cosecha no reinicia las malezas: GDD 78 atribuye esa via solo a `CULTIVATE` y GDD 89
    // recoge el efecto como propio del cultivador. El nivel liquidado en el instante de la
    // cosecha se conserva y el ciclo siguiente arranca con el (correccion W7 del hallazgo H3
    // de docs/revision-formulas.md).
    expect(after['weedLevelBp']).toBe(4_680);
    expect(after['seededAtGameMs']).toBeNull();

    // El ciclo cerrado no deja ninguna transicion de fase pendiente para el campo.
    const pending = await harness.prisma.scheduledEvent.count({
      where: {
        playerId: narrator.playerId,
        refId: fieldId,
        kind: ScheduledEventKind.FIELD_ADVANCE_PHASE,
        status: ScheduledEventStatus.PENDING,
      },
    });
    expect(pending).toBe(0);
  });
});

describe('la transicion automatica por los dos caminos', () => {
  it('el trabajo agendado y la proyeccion dan el mismo resultado y no duplican efectos', async () => {
    // Un jugador por camino: el punto de avance es por jugador, de modo que compartirlo
    // haria que el recuento de eventos de un camino dependiera del otro.
    const byJobPlayer = await register('camino-agendado');
    const byProjectionPlayer = await register('camino-proyectado');
    const jobCells = rect(0, row(34), 4, 1);
    const projectionCells = rect(0, row(36), 4, 1);
    await ownGrass(byJobPlayer.playerId, jobCells);
    await ownGrass(byProjectionPlayer.playerId, projectionCells);

    const jobCreated = await createField('Camino agendado', jobCells, byJobPlayer.accessToken);
    expect(jobCreated.statusCode, JSON.stringify(jobCreated.body)).toBe(200);
    const jobFieldId = (resultOf(jobCreated)['field'] as Record<string, unknown>)['id'] as FieldId;

    const projectionCreated = await createField(
      'Camino proyectado',
      projectionCells,
      byProjectionPlayer.accessToken,
    );
    expect(projectionCreated.statusCode, JSON.stringify(projectionCreated.body)).toBe(200);
    const projectionFieldId = (resultOf(projectionCreated)['field'] as Record<string, unknown>)[
      'id'
    ] as FieldId;

    // Los dos campos se siembran en el mismo instante de juego, de modo que sus dos lineas
    // de tiempo son la misma y las filas son comparables literalmente.
    await operate(byJobPlayer.playerId, jobFieldId, 'PLOW');
    await operate(byJobPlayer.playerId, jobFieldId, 'SEED', 'WHEAT');
    await operate(byProjectionPlayer.playerId, projectionFieldId, 'PLOW');
    await operate(byProjectionPlayer.playerId, projectionFieldId, 'SEED', 'WHEAT');

    // El segundo jugador pierde su fila de outbox: es el caso que el plan describe, el
    // trabajo que nunca corrio, y es lo que aisla el camino de la proyeccion.
    await harness.prisma.scheduledEvent.deleteMany({
      where: { playerId: byProjectionPlayer.playerId },
    });

    harness.advanceGameHours(20);

    // Camino 1: el punto de avance aplica el evento vencido y su manejador materializa. Una
    // frontera por evento, de modo que el siguiente queda agendado y se aplica en otra
    // pasada, que es como se pone al dia un jugador que vuelve tarde. El recuento total no
    // se afirma porque el jugador tiene ademas su barrido periodico de liquidacion.
    const advance = await advancePlayerNow(harness.services, byJobPlayer.playerId);
    expect(advance.unhandledEvents).toBe(0);
    expect((await readRow(jobFieldId))['cropCycleState']).toBe(CropCycleState.GERMINATING);
    const second = await advancePlayerNow(harness.services, byJobPlayer.playerId);
    expect(second.unhandledEvents).toBe(0);
    expect((await readRow(jobFieldId))['cropCycleState']).toBe(CropCycleState.GROWING);

    // Camino 2: sin ningun evento agendado, la proyeccion materializa lo mismo.
    await withPlayerAdvanced(harness.services, byProjectionPlayer.playerId, async (context) => {
      const field = await requireField(context.tx, byProjectionPlayer.playerId, projectionFieldId);
      return materializeProjectedPhase(context.tx, field, context.reading.gameNow);
    });

    const byJob = await readRow(jobFieldId);
    const byProjection = await readRow(projectionFieldId);
    expect(byJob['cropCycleState']).toBe(CropCycleState.GROWING);
    expect(byProjection).toEqual(byJob);

    // Aplicar cualquiera de los dos caminos otra vez no cambia nada ni escribe otro sobre.
    const eventsBefore = await harness.prisma.gameEvent.count({
      where: { playerId: byJobPlayer.playerId, type: 'FIELD_UPSERTED' },
    });
    await advancePlayerNow(harness.services, byJobPlayer.playerId);
    expect(
      await harness.prisma.gameEvent.count({
        where: { playerId: byJobPlayer.playerId, type: 'FIELD_UPSERTED' },
      }),
    ).toBe(eventsBefore);

    await withPlayerAdvanced(harness.services, byProjectionPlayer.playerId, async (context) => {
      const field = await requireField(context.tx, byProjectionPlayer.playerId, projectionFieldId);
      return materializeProjectedPhase(context.tx, field, context.reading.gameNow);
    });

    expect(await readRow(jobFieldId)).toEqual(byJob);
    expect(await readRow(projectionFieldId)).toEqual(byProjection);
  });
});
