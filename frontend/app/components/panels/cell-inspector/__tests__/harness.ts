// The panels of W4-E against the simulated server.
//
// Owner: W4-E. Used by every suite of this workflow that sends a request.
//
// It boots the real client against `app/mock`: the typed client of `net/api.ts`, the reducer
// of `stores/sync.ts` and the sequence rule all run unchanged, and what is replaced is the
// transport and nothing else (`docs/handoff/NOTES-w3c.md`, section 1.7). A panel exercised
// this way is exercising the paths it will use in production, and the replies it reads are
// validated against the Zod schemas of the contract, so a fixture that drifts from the
// schema fails here rather than in the browser.
//
// It lives beside the cell inspector for the same reason `worldAccess.ts` and `fixtures.ts`
// do: this workflow owns ten panel directories and no directory above them, so the shared
// pieces sit in the one whose subject they belong to.

import { createPinia, setActivePinia } from 'pinia';
import { gameBridge } from '~/composables/useGameBridge';
import { useShellUi } from '~/composables/useShellUi';
import { createMockTransport } from '~/mock/index';
import { createMockServer, type MockServer } from '~/mock/server';
import { apiCall, apiOpenSession } from '~/net/api';
import { configureClientRuntime, resetClientRuntime } from '~/net/runtime';
import { resetSession } from '~/net/session';
import { resetHttpTransport, setHttpTransport } from '~/net/transport';
import { MAX_CHUNKS_PER_REQUEST, chunkOf, type CellCoordWire } from '~/shared/index';
import { useClockStore } from '~/stores/clock';
import { useSyncStore } from '~/stores/sync';
import { useWorldStore } from '~/stores/world';

/** Credentials of the development player the simulated server accepts. */
export const MOCK_EMAIL = 'dev@farm-world.local';
export const MOCK_PASSWORD = 'farm-world-dev';

/**
 * A fresh Pinia, a fresh session and a full snapshot applied.
 *
 * The snapshot and not a hand built store: it is what the game page does on mount, it fills
 * every slice at once, and it means the panels are read against the same sample world the
 * browser walkthrough uses.
 */
export async function bootMockClient(): Promise<MockServer> {
  setActivePinia(createPinia());
  resetSession();
  resetClientRuntime();
  configureClientRuntime({ validateReplies: true, requestTimeoutRealMs: 2_000 });
  const server = createMockServer({ sessionOpen: false });
  setHttpTransport(createMockTransport(server));
  await apiOpenSession('POST /api/auth/login', { email: MOCK_EMAIL, password: MOCK_PASSWORD });
  const snapshot = await apiCall('GET /api/state/snapshot');
  useSyncStore().applySnapshot(snapshot);
  // The clock of the panels reads the anchor the snapshot brought; setting the displayed
  // instant to it means a countdown starts from the reply and not from zero.
  const clock = useClockStore();
  const now = clock.gameMsAtRealMs(Date.now());
  if (now !== null) {
    clock.setDisplayGameMs(now);
  }
  return server;
}

export function teardownMockClient(): void {
  resetHttpTransport();
  resetSession();
  resetClientRuntime();
  gameBridge().clear();
  useShellUi().reset();
}

/**
 * Loads the chunks covering a set of cells into the world cache.
 *
 * The panels do this themselves through `ensureChunksFor` when they need it; a suite that
 * wants the cells resolved before mounting asks for them here, so the assertion is about the
 * panel and not about the arrival of a chunk.
 */
export async function loadChunksFor(cells: readonly CellCoordWire[]): Promise<void> {
  const world = useWorldStore();
  const wanted = new Map<string, { chunkX: number; chunkY: number }>();
  for (const cell of cells) {
    const chunk = chunkOf(cell.cellX, cell.cellY, world.chunkSize);
    wanted.set(`${chunk.chunkX}:${chunk.chunkY}`, chunk);
  }
  const reply = await apiCall('POST /api/world/chunks', {
    body: { chunks: [...wanted.values()].map((chunk) => ({ ...chunk })) },
  });
  for (const result of reply.chunks) {
    world.applyChunkResult(result, Date.now());
  }
}

/**
 * The first cell of a square that is unowned grass, that is buyable.
 *
 * Found by scanning and not written down: the terrain is a pure function of the seed and the
 * coordinate, so a hard coded coordinate would be a claim about the generator that a change
 * of its parameters would silently break. The scan uses the same `selectionCellAt` the
 * selection rules read.
 */
export async function findUnownedGrass(
  near: CellCoordWire,
  span = 48,
): Promise<CellCoordWire | null> {
  const world = useWorldStore();
  await loadChunkRect(near.cellX - span, near.cellY - span, near.cellX + span, near.cellY + span);
  for (let cellY = near.cellY - span; cellY <= near.cellY + span; cellY += 1) {
    for (let cellX = near.cellX - span; cellX <= near.cellX + span; cellX += 1) {
      const cell = world.selectionCellAt(cellX, cellY, null);
      if (cell !== null && cell.terrain === 'GRASS' && cell.ownership === 'UNOWNED') {
        return { cellX, cellY };
      }
    }
  }
  return null;
}

/** Loads every chunk covering a rectangle of cells, bounded by the contract. */
export async function loadChunkRect(
  fromCellX: number,
  fromCellY: number,
  toCellX: number,
  toCellY: number,
): Promise<void> {
  const world = useWorldStore();
  const chunks = world
    .chunksForArea(fromCellX, fromCellY, toCellX, toCellY)
    .slice(0, MAX_CHUNKS_PER_REQUEST);
  if (chunks.length === 0) {
    return;
  }
  const reply = await apiCall('POST /api/world/chunks', {
    body: { chunks: chunks.map((chunk) => ({ ...chunk })) },
  });
  for (const result of reply.chunks) {
    world.applyChunkResult(result, Date.now());
  }
}

/** Waits for the promises the panels started under a mount or a click. */
export async function settle(times = 3): Promise<void> {
  for (let round = 0; round < times; round += 1) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
