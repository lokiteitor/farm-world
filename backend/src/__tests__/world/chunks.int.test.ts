// The two routes of the `world` area and the cell repository behind them.
//
// Owner: workflow W3-B. Module `world`.
//
// The properties this file pins down are the ones the design of ADR-0010 rests on, and each
// of them would fail silently if it broke:
//
//   - The terrain does not travel. A reply that started carrying it would still validate
//     against the contract, because `chunkStateSchema` leaves room for it, so the absence is
//     asserted explicitly.
//   - `unchanged` answers the client that is up to date, which is what makes panning back over
//     a chunk free (plan section 9.5).
//   - A batch of fifty chunks costs one statement per stage and never one per chunk.
//   - The overlay cache carries the version in the key, so a modification changes the key and
//     nothing is invalidated: after a write the previous entry is still in Redis, unreferenced
//     and harmless, and the new version misses and repopulates.
//   - `terrainOverride` wins over the generated terrain, which is the cleared forest of GDD
//     section 10.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ClockReading } from '../../lib/gameClock.js';
import { cellRepositoryOf } from '../../modules/world/cellRepo.js';
import { terrainCacheOf } from '../../modules/world/generator.js';
import {
  claimCells,
  loadEffectiveTerrain,
  loadSelectionCells,
} from '../../modules/world/service.js';
import {
  CELL_PX,
  CELL_SIZE_M,
  CellOwnership,
  LandUse,
  MAX_SELECTION_CELLS,
  SHARED_CONTRACT_VERSION,
  TERRAIN_CODE,
  TerrainType,
  cellIndex,
  cellKey,
  worldFromChunk,
  type CellCoord,
  type ChunkCoord,
  type PlayerId,
  type World,
} from '../../shared/index.js';
import { bearer, createHarness, registerViaHttp, type Harness } from '../harness.js';

let harness: Harness;
let reading: ClockReading;
let world: World;
let playerId: PlayerId;
let accessToken: string;

/** A band of chunk coordinates nothing else in this file touches, so tests do not interfere. */
const FREE_CHUNK_Y = 900;

beforeAll(async () => {
  harness = await createHarness();
  reading = await harness.services.clock.read();
  world = reading.world;
  const player = await registerViaHttp(harness, 'chunks');
  playerId = player.playerId;
  accessToken = player.accessToken;
});

afterAll(async () => {
  // `WorldCell.ownerPlayerId` is `onDelete: Restrict`, so the teardown of the harness cannot
  // delete a player that owns land: the cells and their chunks have to go first. Every later
  // workflow that writes `world_cells` needs the same two lines
  // (`docs/handoff/NOTES-w3b.md`, item 3).
  await harness.prisma.worldCell.deleteMany({ where: { worldId: world.id } });
  await harness.prisma.chunk.deleteMany({ where: { worldId: world.id } });
  await harness.prisma.field.deleteMany({ where: { playerId } });
  await harness.teardown();
});

/** A field row, which the exclusivity CHECK demands before a cell may carry `FIELD`. */
async function createFieldRow(): Promise<string> {
  const created = await harness.prisma.field.create({
    data: {
      playerId,
      name: 'Campo de prueba',
      cellCount: 1,
      fertilityUpdatedAtGameMs: reading.gameNow,
      weedLevelUpdatedAtGameMs: reading.gameNow,
      fertilizationUpdatedAtGameMs: reading.gameNow,
      stateEnteredAtGameMs: reading.gameNow,
      createdAtGameMs: reading.gameNow,
    },
    select: { id: true },
  });
  return created.id;
}

/** Posts a batch of chunk requests through the HTTP surface. */
async function postChunks(
  chunks: readonly { chunkX: number; chunkY: number; rev?: number }[],
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/api/world/chunks',
    headers: bearer(accessToken),
    payload: { chunks },
  });
  return { statusCode: response.statusCode, body: response.json<Record<string, unknown>>() };
}

/** Buys a set of cells for the test player, through the same path `land` will use. */
async function claim(cells: readonly CellCoord[]): Promise<{ acquired: number; refused: number }> {
  return harness.services.transaction(async (tx) => {
    const outcome = await claimCells(
      harness.services,
      tx,
      world,
      playerId,
      cells,
      harness.nowRealMs(),
    );
    return { acquired: outcome.acquired.length, refused: outcome.refused.length };
  });
}

describe('GET /api/world/info', () => {
  it('devuelve la semilla, la escala, la version del contrato y el origen del jugador', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/world/info',
      headers: bearer(accessToken),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<Record<string, unknown>>();
    expect(body['worldId']).toBe(world.id);
    expect(body['seed']).toBe(world.seed);
    expect(body['generatorVersion']).toBe(world.generatorVersion);
    expect(body['chunkSize']).toBe(world.chunkSize);
    expect(body['cellSizeM']).toBe(CELL_SIZE_M);
    expect(body['cellPx']).toBe(CELL_PX);
    expect(body['maxSelectionCells']).toBe(MAX_SELECTION_CELLS);
    expect(body['contractVersion']).toBe(SHARED_CONTRACT_VERSION);
    // The origin the registration assigned, which is what the camera opens on.
    expect(typeof body['spawnCellX']).toBe('number');
    expect(typeof body['spawnCellY']).toBe('number');
    const clock = body['clock'] as Record<string, unknown>;
    expect(clock['rateNum']).toBe(world.rateNum);
    expect(clock['rateDen']).toBe(world.rateDen);
  });

  it('exige sesion', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/api/world/info' });
    expect(response.statusCode).toBe(401);
  });
});

describe('POST /api/world/chunks', () => {
  it('no lleva terreno: el cliente lo reproduce con el mismo generador', async () => {
    const { statusCode, body } = await postChunks([{ chunkX: 0, chunkY: FREE_CHUNK_Y }]);
    expect(statusCode).toBe(200);
    const chunks = body['chunks'] as Record<string, unknown>[];
    expect(chunks).toHaveLength(1);
    const chunk = chunks[0] ?? {};
    expect(Object.keys(chunk).sort()).toEqual([
      'cells',
      'chunkX',
      'chunkY',
      'unchanged',
      'version',
    ]);
    expect(chunk['terrain']).toBeUndefined();
    expect(chunk['version']).toBe(0);
    expect(chunk['cells']).toEqual([]);
    expect(typeof body['atGameMs']).toBe('string');
  });

  it('es determinista: dos peticiones iguales devuelven exactamente lo mismo', async () => {
    const request = [
      { chunkX: 1, chunkY: FREE_CHUNK_Y },
      { chunkX: 2, chunkY: FREE_CHUNK_Y },
      { chunkX: -3, chunkY: FREE_CHUNK_Y },
    ];
    const first = await postChunks(request);
    const second = await postChunks(request);
    expect(second.body['chunks']).toEqual(first.body['chunks']);
  });

  it('responde una sola vez a una coordenada repetida, en el orden de la peticion', async () => {
    const { body } = await postChunks([
      { chunkX: 7, chunkY: FREE_CHUNK_Y },
      { chunkX: 8, chunkY: FREE_CHUNK_Y },
      { chunkX: 7, chunkY: FREE_CHUNK_Y },
    ]);
    const chunks = body['chunks'] as Record<string, unknown>[];
    expect(chunks.map((chunk) => chunk['chunkX'])).toEqual([7, 8]);
  });

  it('devuelve la capa de modificaciones de un chunk con celdas compradas', async () => {
    const chunk: ChunkCoord = { chunkX: 20, chunkY: FREE_CHUNK_Y };
    const cells: CellCoord[] = [
      { cellX: chunk.chunkX * world.chunkSize, cellY: chunk.chunkY * world.chunkSize },
      { cellX: chunk.chunkX * world.chunkSize + 1, cellY: chunk.chunkY * world.chunkSize },
    ];
    const outcome = await claim(cells);
    expect(outcome).toEqual({ acquired: 2, refused: 0 });

    const { body } = await postChunks([chunk]);
    const result = (body['chunks'] as Record<string, unknown>[])[0] ?? {};
    expect(result['unchanged']).toBe(false);
    expect(result['version']).toBe(1);
    const patches = result['cells'] as Record<string, unknown>[];
    expect(patches).toHaveLength(2);
    expect(patches.map((patch) => patch['idx'])).toEqual([
      cellIndex(cells[0]?.cellX ?? 0, cells[0]?.cellY ?? 0, world.chunkSize),
      cellIndex(cells[1]?.cellX ?? 0, cells[1]?.cellY ?? 0, world.chunkSize),
    ]);
    for (const patch of patches) {
      expect(patch['ownerPlayerId']).toBe(playerId);
      expect(patch['landUse']).toBe(LandUse.OWNED);
      expect(patch['terrainOverride']).toBeNull();
      expect(patch['fieldId']).toBeNull();
      expect(patch['hasStandingTree']).toBe(false);
    }
  });

  it('responde unchanged cuando la version que trae el cliente esta al dia', async () => {
    const chunk: ChunkCoord = { chunkX: 21, chunkY: FREE_CHUNK_Y };
    await claim([{ cellX: chunk.chunkX * world.chunkSize, cellY: chunk.chunkY * world.chunkSize }]);

    const current = await postChunks([chunk]);
    const version = ((current.body['chunks'] as Record<string, unknown>[])[0] ?? {})['version'];
    expect(version).toBe(1);

    const upToDate = await postChunks([{ ...chunk, rev: 1 }]);
    const result = (upToDate.body['chunks'] as Record<string, unknown>[])[0] ?? {};
    expect(result['unchanged']).toBe(true);
    // The union is strict: an `unchanged` chunk carries no cells at all, which is what makes
    // the answer cheap on the wire and unambiguous in the client reducer.
    expect(Object.keys(result).sort()).toEqual(['chunkX', 'chunkY', 'unchanged', 'version']);

    const behind = await postChunks([{ ...chunk, rev: 0 }]);
    const stale = (behind.body['chunks'] as Record<string, unknown>[])[0] ?? {};
    expect(stale['unchanged']).toBe(false);
    expect((stale['cells'] as unknown[]).length).toBe(1);
  });

  it('responde unchanged con rev 0 a un chunk que nunca se modifico', async () => {
    const { body } = await postChunks([{ chunkX: 400, chunkY: FREE_CHUNK_Y, rev: 0 }]);
    const result = (body['chunks'] as Record<string, unknown>[])[0] ?? {};
    expect(result['unchanged']).toBe(true);
    expect(result['version']).toBe(0);
  });

  it('rechaza un lote mayor que el tope del contrato', async () => {
    const chunks = Array.from({ length: 65 }, (_unused, index) => ({
      chunkX: index,
      chunkY: FREE_CHUNK_Y + 1,
    }));
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/world/chunks',
      headers: bearer(accessToken),
      payload: { chunks },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('el repositorio de celdas', () => {
  it('resuelve un lote de 50 chunks con una consulta de versiones y una de celdas', async () => {
    const repository = cellRepositoryOf(harness.services);
    const chunkY = FREE_CHUNK_Y + 10;
    const cells: CellCoord[] = [];
    const chunks: ChunkCoord[] = [];
    for (let index = 0; index < 50; index += 1) {
      chunks.push({ chunkX: index, chunkY });
      cells.push({ cellX: index * world.chunkSize, cellY: chunkY * world.chunkSize });
    }
    const outcome = await claim(cells);
    expect(outcome.acquired).toBe(50);

    // Cold cache: one statement for the versions and one for the overlay of the fifty chunks,
    // plus a single round trip to Redis in each direction. Never one per chunk.
    for (const chunk of chunks) {
      await harness.redis.commands.del(repository.overlayKey(world.id, chunk, 1));
    }
    repository.resetStats();
    const cold = await repository.chunkStates(harness.prisma, world, chunks);
    expect(cold).toHaveLength(50);
    expect(cold.every((state) => state.cells.length === 1)).toBe(true);
    expect(repository.stats()).toMatchObject({
      versionQueries: 1,
      cellQueries: 1,
      overlayMisses: 50,
      overlayHits: 0,
      redisReads: 1,
      redisWrites: 1,
    });

    // Warm cache: the overlay comes from Redis and PostgreSQL is only asked for the versions,
    // which is the statement no cache can replace without becoming authoritative for them.
    repository.resetStats();
    const warm = await repository.chunkStates(harness.prisma, world, chunks);
    expect(warm).toEqual(cold);
    expect(repository.stats()).toMatchObject({
      versionQueries: 1,
      cellQueries: 0,
      overlayHits: 50,
      overlayMisses: 0,
      redisReads: 1,
      redisWrites: 0,
    });

    // Up to date client: neither Redis nor the overlay statement is touched at all.
    repository.resetStats();
    await repository.chunkStates(
      harness.prisma,
      world,
      chunks.map((chunk) => ({ ...chunk, rev: 1 })),
    );
    expect(repository.stats()).toMatchObject({
      versionQueries: 1,
      cellQueries: 0,
      redisReads: 0,
      unchangedChunks: 50,
    });
  });

  it('cachea el solape con la version en la clave, de modo que nada se invalida', async () => {
    const repository = cellRepositoryOf(harness.services);
    const chunk: ChunkCoord = { chunkX: 30, chunkY: FREE_CHUNK_Y };
    const firstCell = {
      cellX: chunk.chunkX * world.chunkSize,
      cellY: chunk.chunkY * world.chunkSize,
    };
    await claim([firstCell]);
    await repository.chunkStates(harness.prisma, world, [chunk]);
    const keyAtOne = repository.overlayKey(world.id, chunk, 1);
    expect(await harness.redis.commands.exists(keyAtOne)).toBe(1);

    // A second purchase in the same chunk moves it to version 2. The entry of version 1 is
    // still there and is still correct for version 1; it is simply never asked for again.
    await claim([{ cellX: firstCell.cellX + 1, cellY: firstCell.cellY }]);
    const keyAtTwo = repository.overlayKey(world.id, chunk, 2);
    expect(keyAtTwo).not.toBe(keyAtOne);
    expect(await harness.redis.commands.exists(keyAtOne)).toBe(1);
    expect(await harness.redis.commands.exists(keyAtTwo)).toBe(0);

    repository.resetStats();
    const states = await repository.chunkStates(harness.prisma, world, [chunk]);
    expect(states[0]?.version).toBe(2);
    expect(states[0]?.cells).toHaveLength(2);
    expect(repository.stats()).toMatchObject({ overlayMisses: 1, overlayHits: 0 });
    expect(await harness.redis.commands.exists(keyAtTwo)).toBe(1);
  });

  it('reclama por actualizacion condicional: la segunda compra no adquiere nada', async () => {
    const cell: CellCoord = {
      cellX: 40 * world.chunkSize,
      cellY: FREE_CHUNK_Y * world.chunkSize,
    };
    const first = await claim([cell]);
    expect(first).toEqual({ acquired: 1, refused: 0 });
    const second = await claim([cell]);
    expect(second).toEqual({ acquired: 0, refused: 1 });

    // The refused claim touched no chunk, so the version did not move either.
    const repository = cellRepositoryOf(harness.services);
    const versions = await repository.chunkVersions(harness.prisma, world.id, [
      { chunkX: 40, chunkY: FREE_CHUNK_Y },
    ]);
    expect(versions.get(`40:${FREE_CHUNK_Y}`)).toBe(1);
  });

  it('incrementa la version de cada chunk tocado por una compra multi chunk', async () => {
    const repository = cellRepositoryOf(harness.services);
    const chunkY = FREE_CHUNK_Y + 20;
    const cells: CellCoord[] = [
      { cellX: 0, cellY: chunkY * world.chunkSize },
      { cellX: world.chunkSize, cellY: chunkY * world.chunkSize },
      { cellX: 2 * world.chunkSize, cellY: chunkY * world.chunkSize },
    ];
    await claim(cells);
    const versions = await repository.chunkVersions(harness.prisma, world.id, [
      { chunkX: 0, chunkY },
      { chunkX: 1, chunkY },
      { chunkX: 2, chunkY },
    ]);
    expect([...versions.values()]).toEqual([1, 1, 1]);
  });

  it('asigna el uso de una celda por actualizacion condicional con recuento', async () => {
    const repository = cellRepositoryOf(harness.services);
    const chunkY = FREE_CHUNK_Y + 30;
    const owned: CellCoord = { cellX: 0, cellY: chunkY * world.chunkSize };
    const notOwned: CellCoord = { cellX: 1, cellY: chunkY * world.chunkSize };
    await claim([owned]);
    const fieldId = await createFieldRow();

    // Only the owned cell is available, so the update affects one row of the two and reports
    // the mismatch instead of leaving half a field behind. The caller aborts on `complete`
    // being false, which is what keeps a partial geometry from being committed.
    const outcome = await harness.services.transaction((tx) =>
      repository.assignCellUse(tx, {
        world,
        playerId,
        cells: [owned, notOwned],
        landUse: LandUse.FIELD,
        fieldId,
        atRealMs: harness.nowRealMs(),
      }),
    );
    expect(outcome.affected).toBe(1);
    expect(outcome.complete).toBe(false);

    const patched = await repository.chunkStates(harness.prisma, world, [{ chunkX: 0, chunkY }]);
    expect(patched[0]?.cells[0]?.landUse).toBe(LandUse.FIELD);
    expect(patched[0]?.cells[0]?.fieldId).toBe(fieldId);
  });

  it('rechaza una asignacion cuyos identificadores no casan con el uso', async () => {
    const repository = cellRepositoryOf(harness.services);
    const cell: CellCoord = { cellX: 0, cellY: (FREE_CHUNK_Y + 35) * world.chunkSize };
    await claim([cell]);
    // `world_cells_use_exclusivity_check` would refuse this too, and that is the point: a
    // constraint violation raised inside a queue job retries for ever, so the application
    // refuses first (plan section 5.4).
    await expect(
      harness.services.transaction((tx) =>
        repository.assignCellUse(tx, {
          world,
          playerId,
          cells: [cell],
          landUse: LandUse.FIELD,
          atRealMs: harness.nowRealMs(),
        }),
      ),
    ).rejects.toThrow('world_cells_use_exclusivity_check');
  });
});

describe('el terreno efectivo', () => {
  it('refleja terrainOverride por encima del terreno generado', async () => {
    const cache = terrainCacheOf(harness.services);
    // A cell the generator did not make grass, so the override is observable rather than a
    // coincidence. Searched rather than assumed, because the seed of the run is random.
    let target: CellCoord | null = null;
    let generated: TerrainType | null = null;
    for (let chunkX = 0; chunkX < 16 && target === null; chunkX += 1) {
      const chunk: ChunkCoord = { chunkX, chunkY: FREE_CHUNK_Y + 40 };
      const bytes = await cache.chunk(world, chunk);
      for (let index = 0; index < bytes.length; index += 1) {
        if (bytes[index] !== TERRAIN_CODE.GRASS) {
          target = worldFromChunk(chunk, index, world.chunkSize);
          generated =
            bytes[index] === TERRAIN_CODE.FOREST
              ? TerrainType.FOREST
              : bytes[index] === TERRAIN_CODE.MOUNTAIN
                ? TerrainType.MOUNTAIN
                : TerrainType.WATER;
          break;
        }
      }
    }
    expect(target).not.toBeNull();
    const cell = target ?? { cellX: 0, cellY: 0 };

    const before = await loadEffectiveTerrain(harness.services, harness.prisma, world, [cell]);
    expect(before.get(cellKey(cell.cellX, cell.cellY))).toBe(generated);

    await claim([cell]);
    // What `CLEAR_LAND` of GDD section 10 will write: the cleared forest becomes grass.
    await harness.prisma.worldCell.updateMany({
      where: { worldId: world.id, cellX: cell.cellX, cellY: cell.cellY },
      data: { terrainOverride: TerrainType.GRASS },
    });

    const after = await loadEffectiveTerrain(harness.services, harness.prisma, world, [cell]);
    expect(after.get(cellKey(cell.cellX, cell.cellY))).toBe(TerrainType.GRASS);
    expect(after.get(cellKey(cell.cellX, cell.cellY))).not.toBe(generated);

    // And the same override reaches the selection rules, which is what decides whether the
    // cell can become part of a field.
    const selection = await loadSelectionCells(harness.services, harness.prisma, world, playerId, [
      cell,
    ]);
    expect(selection[0]?.terrain).toBe(TerrainType.GRASS);
    expect(selection[0]?.ownership).toBe(CellOwnership.PLAYER);
    expect(selection[0]?.landUse).toBe(LandUse.OWNED);
    expect(selection[0]?.hasStandingTree).toBe(false);
  });

  it('trata la ausencia de fila como celda libre, sin dueno y sin uso', async () => {
    const cell: CellCoord = { cellX: 5, cellY: (FREE_CHUNK_Y + 50) * world.chunkSize };
    const selection = await loadSelectionCells(harness.services, harness.prisma, world, playerId, [
      cell,
    ]);
    expect(selection[0]?.ownership).toBe(CellOwnership.UNOWNED);
    expect(selection[0]?.landUse).toBe(LandUse.NONE);
    expect(selection[0]?.hasStandingTree).toBe(false);
  });
});
