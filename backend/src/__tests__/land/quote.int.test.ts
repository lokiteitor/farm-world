// `POST /api/land/quote`: the budget of a selection, mutating nothing.
//
// Owner: workflow W4-A. Module `land`.
//
// What this file pins down, and why each one would fail silently otherwise:
//
//   - The prices of GDD section 115 come out of the catalogue and not out of a literal:
//     330 grass cells cost exactly 39 600, which is the figure of GDD section 117, and
//     forest costs 70 while grass costs 120.
//   - `price` is null exactly when `blockedBy` is not, which is the invariant the contract
//     states and the one the panel relies on to avoid showing two contradictory signals.
//   - Mountain and water are refused with `TERRAIN_NOT_PURCHASABLE` and an owned cell with
//     `CELL_ALREADY_OWNED` (GDD sections 8, 11, 12 and 14).
//   - The quote mutates nothing: no cell row, no chunk row and no ledger entry.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ClockReading } from '../../lib/gameClock.js';
import { claimCells } from '../../modules/world/service.js';
import {
  MAX_SELECTION_CELLS,
  Money,
  TerrainType,
  ValidationCode,
  type CellCoord,
  type PlayerId,
  type World,
} from '../../shared/index.js';
import { bearer, createHarness, registerViaHttp, type Harness } from '../harness.js';
import { balanceOf, clearGrid, errorCode, findCellsOfTerrain, postQuote } from './fixtures.js';

let harness: Harness;
let reading: ClockReading;
let world: World;
let playerId: PlayerId;
let accessToken: string;

/** Chunk rows this file owns. No other suite of the module touches them. */
const BAND = { GRASS: 500, FOREST: 505, MOUNTAIN: 510, WATER: 515, OWNED: 520 } as const;

beforeAll(async () => {
  harness = await createHarness();
  reading = await harness.services.clock.read();
  world = reading.world;
  const player = await registerViaHttp(harness, 'land-quote');
  playerId = player.playerId;
  accessToken = player.accessToken;
});

afterAll(async () => {
  await clearGrid(harness, world);
  await harness.teardown();
});

describe('POST /api/land/quote', () => {
  it('presupuesta 330 celdas de pradera a 120 cada una: 39.600 (GDD 115 y 117)', async () => {
    const cells = await findCellsOfTerrain(harness, world, TerrainType.GRASS, 330, {
      chunkY: BAND.GRASS,
    });
    const { statusCode, body } = await postQuote(harness, accessToken, cells);

    expect(statusCode).toBe(200);
    expect(body['purchasableCount']).toBe(330);
    expect(body['blockedCount']).toBe(0);
    expect(body['total']).toBe(Money.toString(Money.fromUnits(39_600)));
    expect(body['firstBlockedCell']).toBeNull();
    expect(body['affordable']).toBe(true);

    const quoted = body['cells'] as Record<string, unknown>[];
    expect(quoted).toHaveLength(330);
    for (const cell of quoted) {
      expect(cell['terrain']).toBe(TerrainType.GRASS);
      expect(cell['blockedBy']).toBeNull();
      expect(cell['price']).toBe(Money.toString(Money.fromUnits(120)));
    }
  });

  it('presupuesta el bosque a 70 la celda (GDD 115)', async () => {
    const cells = await findCellsOfTerrain(harness, world, TerrainType.FOREST, 10, {
      chunkY: BAND.FOREST,
    });
    const { body } = await postQuote(harness, accessToken, cells);

    expect(body['purchasableCount']).toBe(10);
    expect(body['total']).toBe(Money.toString(Money.fromUnits(700)));
    for (const cell of body['cells'] as Record<string, unknown>[]) {
      expect(cell['terrain']).toBe(TerrainType.FOREST);
      expect(cell['price']).toBe(Money.toString(Money.fromUnits(70)));
    }
  });

  it('mezcla pradera y bosque y suma cada terreno con su precio', async () => {
    const grass = await findCellsOfTerrain(harness, world, TerrainType.GRASS, 5, {
      chunkY: BAND.GRASS,
      fromChunkX: 20,
    });
    const forest = await findCellsOfTerrain(harness, world, TerrainType.FOREST, 3, {
      chunkY: BAND.FOREST,
      fromChunkX: 20,
    });
    const { body } = await postQuote(harness, accessToken, [...grass, ...forest]);

    // 5 x 120 + 3 x 70 = 810.
    expect(body['total']).toBe(Money.toString(Money.fromUnits(810)));
    expect(body['purchasableCount']).toBe(8);
  });

  it('marca la montana y el agua como no comprables, con precio nulo (GDD 8, 11 y 12)', async () => {
    for (const terrain of [TerrainType.MOUNTAIN, TerrainType.WATER] as const) {
      const cells = await findCellsOfTerrain(harness, world, terrain, 3, {
        chunkY: terrain === TerrainType.MOUNTAIN ? BAND.MOUNTAIN : BAND.WATER,
      });
      const { body } = await postQuote(harness, accessToken, cells);

      expect(body['purchasableCount']).toBe(0);
      expect(body['blockedCount']).toBe(3);
      expect(body['total']).toBe(Money.toString(Money.ZERO));
      expect(body['firstBlockedCell']).toEqual({
        cellX: cells[0]?.cellX,
        cellY: cells[0]?.cellY,
      });
      for (const cell of body['cells'] as Record<string, unknown>[]) {
        expect(cell['blockedBy']).toBe(ValidationCode.TERRAIN_NOT_PURCHASABLE);
        // The contract requires the two signals never to contradict each other.
        expect(cell['price']).toBeNull();
      }
    }
  });

  it('marca una celda ya poseida como CELL_ALREADY_OWNED (GDD 14)', async () => {
    const cells = await findCellsOfTerrain(harness, world, TerrainType.GRASS, 2, {
      chunkY: BAND.OWNED,
    });
    await harness.services.transaction((tx) =>
      claimCells(
        harness.services,
        tx,
        world,
        playerId,
        [cells[0] as CellCoord],
        harness.nowRealMs(),
      ),
    );

    const { body } = await postQuote(harness, accessToken, cells);
    const quoted = body['cells'] as Record<string, unknown>[];
    expect(quoted[0]?.['blockedBy']).toBe(ValidationCode.CELL_ALREADY_OWNED);
    expect(quoted[0]?.['price']).toBeNull();
    expect(quoted[1]?.['blockedBy']).toBeNull();
    expect(body['purchasableCount']).toBe(1);
    expect(body['blockedCount']).toBe(1);
    // Only the cell that can still be bought is priced.
    expect(body['total']).toBe(Money.toString(Money.fromUnits(120)));
  });

  it('colapsa las celdas repetidas antes de presupuestar', async () => {
    const cells = await findCellsOfTerrain(harness, world, TerrainType.GRASS, 2, {
      chunkY: BAND.GRASS,
      fromChunkX: 40,
    });
    const cell = cells[0] as CellCoord;
    const { body } = await postQuote(harness, accessToken, [cell, cell, cell]);

    expect((body['cells'] as unknown[]).length).toBe(1);
    expect(body['purchasableCount']).toBe(1);
    // Pricing the repeat would quote a total the purchase could never charge, because the
    // unique index on the cell makes the second copy acquire nothing.
    expect(body['total']).toBe(Money.toString(Money.fromUnits(120)));
  });

  it('informa del saldo liquidado y de si el total es asumible', async () => {
    const cells = await findCellsOfTerrain(harness, world, TerrainType.GRASS, 1, {
      chunkY: BAND.GRASS,
      fromChunkX: 50,
    });
    const { body } = await postQuote(harness, accessToken, cells);
    expect(body['balance']).toBe(await balanceOf(harness, playerId));
    expect(body['affordable']).toBe(true);
  });

  it('no muta nada: ni celdas, ni chunks, ni asientos', async () => {
    const cells = await findCellsOfTerrain(harness, world, TerrainType.GRASS, 20, {
      chunkY: BAND.GRASS,
      fromChunkX: 60,
    });
    const before = {
      cells: await harness.prisma.worldCell.count({ where: { worldId: world.id } }),
      chunks: await harness.prisma.chunk.count({ where: { worldId: world.id } }),
      entries: await harness.prisma.ledgerEntry.count({ where: { playerId } }),
      balance: await balanceOf(harness, playerId),
    };

    expect((await postQuote(harness, accessToken, cells)).statusCode).toBe(200);

    expect(await harness.prisma.worldCell.count({ where: { worldId: world.id } })).toBe(
      before.cells,
    );
    expect(await harness.prisma.chunk.count({ where: { worldId: world.id } })).toBe(before.chunks);
    expect(await harness.prisma.ledgerEntry.count({ where: { playerId } })).toBe(before.entries);
    expect(await balanceOf(harness, playerId)).toBe(before.balance);
  });

  it('rechaza una seleccion por encima del tope compartido de celdas', async () => {
    // The ceiling is `MAX_SELECTION_CELLS` and it is one constant applied twice: the client
    // stops the drag at it and the contract schema caps the array at the same value, so the
    // highlight and the refusal cannot disagree (ADR-0012).
    const cells: CellCoord[] = Array.from(
      { length: MAX_SELECTION_CELLS + 1 },
      (_unused, index) => ({
        cellX: index,
        cellY: BAND.GRASS * world.chunkSize,
      }),
    );
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/land/quote',
      headers: bearer(accessToken),
      payload: { cells },
    });
    expect(response.statusCode).toBe(400);
    expect(errorCode(response.json<Record<string, unknown>>())).toBe(
      ValidationCode.VALIDATION_FAILED,
    );
  });

  it('exige sesion', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/land/quote',
      payload: { cells: [{ cellX: 0, cellY: 0 }] },
    });
    expect(response.statusCode).toBe(401);
  });
});
