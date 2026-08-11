// The origin allocator: the pure lattice and the operation that persists it.
//
// Owner: workflow W3-B. Module `world`.
//
// Two guarantees are asserted, and they are different in kind. That an origin exists at all
// is a property of the generator and of the seed, so it is measured over two hundred seeds.
// That two players never share land is a property of the lattice, so it is asserted as an
// exact separation over consecutive player indices rather than sampled: the guarantee of
// ADR-0014 is structural, and a probabilistic assertion would hide the day it stops being so.

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ClockReading } from '../../lib/gameClock.js';
import { lockWorld } from '../../lib/tx.js';
import {
  allocateSpawn,
  assignAndPersistSpawn,
  nearestOriginDistance,
  originDistanceChunks,
} from '../../modules/world/spawn.js';
import {
  MIN_SPAWN_GRASS_CELLS,
  SPAWN_MIN_DISTANCE_CHUNKS,
  assignSpawn,
  type CellCoord,
  type PlayerId,
  type World,
} from '../../shared/index.js';
import { createHarness, registerViaHttp, type Harness } from '../harness.js';

let harness: Harness;
let reading: ClockReading;
let world: World;

beforeAll(async () => {
  harness = await createHarness();
  reading = await harness.services.clock.read();
  world = reading.world;
});

afterAll(async () => {
  await harness.teardown();
});

/** A player row with no origin, so a test can allocate one for it. */
async function createBarePlayer(label: string): Promise<PlayerId> {
  const created = await harness.prisma.player.create({
    data: {
      worldId: world.id,
      email: `w3b-${harness.runId}-${label}-${randomUUID().slice(0, 6)}@test.invalid`,
      passwordHash: 'not-a-real-hash',
      displayName: `Origen ${label}`,
      startedAtGameMs: reading.gameNow,
      lastAccrualGameMs: reading.gameNow,
      lastLoginGameMs: reading.gameNow,
      lastSummaryGameMs: reading.gameNow,
      createdAtRealMs: reading.atRealMs,
    },
    select: { id: true },
  });
  const playerId = created.id as PlayerId;
  harness.track(playerId);
  return playerId;
}

describe('el asignador determinista de origen', () => {
  it('encuentra un origen valido en 200 semillas', () => {
    let below = 0;
    let outsideBlock = 0;
    let inspected = 0;
    for (let seed = 1; seed <= 200; seed += 1) {
      const assignment = assignSpawn(seed, 0, { chunkSize: world.chunkSize });
      inspected += assignment.chunksInspected;
      if (!assignment.meetsMinimum) {
        below += 1;
      }
      if (!assignment.withinReservedBlock) {
        outsideBlock += 1;
      }
      expect(assignment.contiguousGrassCells).toBeGreaterThanOrEqual(MIN_SPAWN_GRASS_CELLS);
    }
    expect(below).toBe(0);
    // The widening search outside the reserved block is a safety net and not a budget: if it
    // starts firing, the separation guarantee stops being structural.
    expect(outsideBlock).toBe(0);
    expect(inspected / 200).toBeLessThan(5);
  });

  it('nunca coloca dos jugadores a menos de la separacion minima', () => {
    const seed = 20260811;
    const origins: CellCoord[] = [];
    for (let playerIndex = 0; playerIndex < 50; playerIndex += 1) {
      const assignment = assignSpawn(seed, playerIndex, { chunkSize: world.chunkSize });
      expect(assignment.withinReservedBlock).toBe(true);
      origins.push(assignment.originCell);
    }
    let minimum = Number.POSITIVE_INFINITY;
    for (let left = 0; left < origins.length; left += 1) {
      for (let right = left + 1; right < origins.length; right += 1) {
        const a = origins[left];
        const b = origins[right];
        if (a === undefined || b === undefined) {
          continue;
        }
        minimum = Math.min(minimum, originDistanceChunks(a, b, world.chunkSize));
      }
    }
    expect(minimum).toBeGreaterThanOrEqual(SPAWN_MIN_DISTANCE_CHUNKS);
  });

  it('mide la separacion en chunks y como distancia de Chebyshev', () => {
    const size = world.chunkSize;
    expect(originDistanceChunks({ cellX: 0, cellY: 0 }, { cellX: 0, cellY: 0 }, size)).toBe(0);
    // Diagonal: eight chunks on each axis is eight chunks away, not eleven.
    expect(
      originDistanceChunks({ cellX: 0, cellY: 0 }, { cellX: 8 * size, cellY: 8 * size }, size),
    ).toBe(8);
    expect(nearestOriginDistance({ cellX: 0, cellY: 0 }, [], size)).toBeNull();
    expect(
      nearestOriginDistance({ cellX: 0, cellY: 0 }, [{ cellX: 3 * size, cellY: 0 }], size),
    ).toBe(3);
  });
});

describe('la asignacion de origen sobre la base de datos', () => {
  it('persiste el origen en el jugador y respeta lo ya persistido', async () => {
    const playerId = await createBarePlayer('persist');
    const allocation = await harness.services.transaction(async (tx) => {
      const lock = await lockWorld(tx, world.id);
      if (lock === null) {
        throw new Error('el mundo de la prueba no existe');
      }
      return assignAndPersistSpawn(tx, world, lock, playerId);
    });

    expect(allocation.assignment.meetsMinimum).toBe(true);
    expect(allocation.respectsMinimumDistance).toBe(true);
    expect(allocation.attempts).toBe(1);

    const row = await harness.prisma.player.findUniqueOrThrow({
      where: { id: playerId },
      select: { spawnCellX: true, spawnCellY: true },
    });
    expect(row.spawnCellX).toBe(allocation.assignment.originCell.cellX);
    expect(row.spawnCellY).toBe(allocation.assignment.originCell.cellY);
  });

  it('no solapa dos jugadores registrados por la superficie HTTP', async () => {
    const first = await registerViaHttp(harness, 'spawn-a');
    const second = await registerViaHttp(harness, 'spawn-b');
    const rows = await harness.prisma.player.findMany({
      where: { id: { in: [first.playerId, second.playerId] } },
      select: { spawnCellX: true, spawnCellY: true },
    });
    expect(rows).toHaveLength(2);
    const [left, right] = rows;
    expect(left?.spawnCellX).not.toBeNull();
    expect(right?.spawnCellX).not.toBeNull();
    const distance = originDistanceChunks(
      { cellX: left?.spawnCellX ?? 0, cellY: left?.spawnCellY ?? 0 },
      { cellX: right?.spawnCellX ?? 0, cellY: right?.spawnCellY ?? 0 },
      world.chunkSize,
    );
    expect(distance).toBeGreaterThanOrEqual(SPAWN_MIN_DISTANCE_CHUNKS);
  });

  it('es total: con una separacion inalcanzable se conforma en lugar de fallar', async () => {
    const playerId = await createBarePlayer('unreachable');
    const allocation = await harness.services.transaction(async (tx) => {
      const lock = await lockWorld(tx, world.id);
      if (lock === null) {
        throw new Error('el mundo de la prueba no existe');
      }
      // A separation no lattice can satisfy, which is the degenerate case the allocator has
      // to survive: a registration that fails is worse for the player than a close neighbour.
      return allocateSpawn(tx, world, lock, {
        minDistanceChunks: 100_000,
        maxIndexAttempts: 3,
      });
    });
    expect(allocation.attempts).toBe(3);
    expect(allocation.respectsMinimumDistance).toBe(false);
    expect(allocation.assignment.meetsMinimum).toBe(true);
    // It still answers a usable origin, which is the whole point of settling.
    expect(Number.isInteger(allocation.assignment.originCell.cellX)).toBe(true);
    await harness.prisma.player.deleteMany({ where: { id: playerId } });
  });
});
