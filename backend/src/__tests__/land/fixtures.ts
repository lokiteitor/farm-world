// Shared fixtures of the `land` suite.
//
// Owner: workflow W4-A. Module `land`.
//
// The world of the harness carries a random negative seed, so no coordinate has a known
// terrain: a test that hard coded one would pass or fail depending on the run. Every cell
// used here is therefore found by running the same deterministic generator the module
// runs, which is also the honest way to test it — the assertions then hold for any seed.
//
// The chunk bands are disjoint per test file and per case, so two cases never contend for
// the same cell and the concurrency case contends on purpose.

import { randomUUID } from 'node:crypto';
import { terrainCacheOf } from '../../modules/world/generator.js';
import {
  Money,
  TERRAIN_CODE,
  type TerrainType,
  worldFromChunk,
  type CellCoord,
  type PlayerId,
  type World,
} from '../../shared/index.js';
import { bearer, type Harness } from '../harness.js';

/** Chunks a search walks before it gives up. Ample: a chunk holds 1 024 cells. */
const MAX_CHUNKS_SCANNED = 64;

/**
 * `count` cells of one terrain, taken from the chunks of a row starting at `fromChunkX`.
 *
 * Row major inside every chunk and chunk by chunk to the east, so the answer is
 * deterministic for a seed and two calls with the same arguments return the same cells.
 */
export async function findCellsOfTerrain(
  harness: Harness,
  world: World,
  terrain: TerrainType,
  count: number,
  band: { readonly chunkY: number; readonly fromChunkX?: number },
): Promise<readonly CellCoord[]> {
  const cache = terrainCacheOf(harness.services);
  const wanted = TERRAIN_CODE[terrain];
  const found: CellCoord[] = [];
  const fromChunkX = band.fromChunkX ?? 0;

  for (let offset = 0; offset < MAX_CHUNKS_SCANNED && found.length < count; offset += 1) {
    const chunk = { chunkX: fromChunkX + offset, chunkY: band.chunkY };
    const bytes = await cache.chunk(world, chunk);
    for (let index = 0; index < bytes.length && found.length < count; index += 1) {
      if (bytes[index] === wanted) {
        found.push(worldFromChunk(chunk, index, world.chunkSize));
      }
    }
  }

  if (found.length < count) {
    throw new Error(
      `El generador no produjo ${count} celdas de ${terrain} en la banda chunkY=${band.chunkY} ` +
        `tras ${MAX_CHUNKS_SCANNED} chunks: encontradas ${found.length}.`,
    );
  }
  return found;
}

/** Body of `POST /api/land/quote`. */
export async function postQuote(
  harness: Harness,
  accessToken: string,
  cells: readonly CellCoord[],
): Promise<{ readonly statusCode: number; readonly body: Record<string, unknown> }> {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/api/land/quote',
    headers: bearer(accessToken),
    payload: { cells },
  });
  return { statusCode: response.statusCode, body: response.json<Record<string, unknown>>() };
}

export interface PurchaseRequest {
  readonly cells: readonly CellCoord[];
  readonly allowPartial?: boolean;
  readonly expectedTotal?: string;
  readonly idempotencyKey?: string;
}

/** Body of `POST /api/land/purchase`, with the header the contract demands. */
export async function postPurchase(
  harness: Harness,
  accessToken: string,
  request: PurchaseRequest,
): Promise<{ readonly statusCode: number; readonly body: Record<string, unknown> }> {
  const payload: Record<string, unknown> = {
    cells: request.cells,
    allowPartial: request.allowPartial ?? false,
  };
  if (request.expectedTotal !== undefined) {
    payload['expectedTotal'] = request.expectedTotal;
  }
  const response = await harness.app.inject({
    method: 'POST',
    url: '/api/land/purchase',
    headers: {
      ...bearer(accessToken),
      'idempotency-key': request.idempotencyKey ?? `land-${randomUUID()}`,
    },
    payload,
  });
  return { statusCode: response.statusCode, body: response.json<Record<string, unknown>>() };
}

/** The `code` of an error reply, or null when the reply is not one. */
export function errorCode(body: Record<string, unknown>): string | null {
  const error = body['error'];
  if (typeof error !== 'object' || error === null) {
    return null;
  }
  const code = (error as Record<string, unknown>)['code'];
  return typeof code === 'string' ? code : null;
}

/** The `result` of a mutating reply. */
export function mutationResult(body: Record<string, unknown>): Record<string, unknown> {
  return (body['result'] ?? {}) as Record<string, unknown>;
}

/**
 * Removes every cell and chunk of the world.
 *
 * `WorldCell.ownerPlayerId` is `onDelete: Restrict`, so the teardown of the harness cannot
 * delete a player that owns land: the cells and their chunks have to go first. Every
 * workflow that writes `world_cells` needs the same two statements.
 */
export async function clearGrid(harness: Harness, world: World): Promise<void> {
  await harness.prisma.worldCell.deleteMany({ where: { worldId: world.id } });
  await harness.prisma.chunk.deleteMany({ where: { worldId: world.id } });
}

/**
 * The settled balance of a player, in the canonical four decimal form.
 *
 * `Decimal.toString()` drops the trailing zeroes of `numeric(20,4)`, so the column reads
 * back as `160000` while the wire and the ledger carry `160000.0000`. Normalising here is
 * what lets a test compare the column against a reply without either side deciding a
 * format (ADR-0008).
 */
export async function balanceOf(harness: Harness, playerId: PlayerId): Promise<Money> {
  const player = await harness.prisma.player.findUniqueOrThrow({
    where: { id: playerId },
    select: { balance: true },
  });
  return Money.fromString(player.balance.toString());
}
